import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { after } from 'lodash';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { FlowProducer, Queue, QueueEvents, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Cleaner', () => {
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;
  const connection = { host: 'localhost' };

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection });
    queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();
    await queue.waitUntilReady();
  });

  afterEach(async function () {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should clean an empty queue', async () => {
    const waitCleaned = new Promise<void>(resolve => {
      queue.on('cleaned', (jobs, type) => {
        expect(type).to.be.eql('completed');
        expect(jobs.length).to.be.eql(0);
        resolve();
      });
    });

    const jobs = await queue.clean(0, 0);

    expect(jobs.length).to.be.eql(0);

    await waitCleaned;
  });

  it('should clean two jobs from the queue', async () => {
    const worker = new Worker(queueName, async () => {}, { connection });
    await worker.waitUntilReady();

    const completing = new Promise<void>(resolve => {
      worker.on(
        'completed',
        after(2, async () => {
          resolve();
        }),
      );
    });

    await queue.addBulk([
      { name: 'test', data: { some: 'data' } },
      { name: 'test', data: { some: 'data' } },
    ]);

    await completing;
    await delay(1);

    const jobs = await queue.clean(0, 0);
    expect(jobs.length).to.be.eql(2);

    await worker.close();
  });

  it('should succeed when the limit is higher than the actual number of jobs', async () => {
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await delay(100);
    const deletedJobs = await queue.clean(0, 100, 'wait');
    expect(deletedJobs).to.have.length(2);
    const remainingJobsCount = await queue.count();
    expect(remainingJobsCount).to.be.eql(0);
  });

  it('should only remove a job outside of the grace period', async () => {
    const worker = new Worker(queueName, async () => {}, { connection });
    await worker.waitUntilReady();

    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await delay(200);
    await queue.add('test', { some: 'data' });
    await queue.clean(100, 100);
    await delay(100);
    const jobs = await queue.getCompleted();
    expect(jobs.length).to.be.eql(1);

    await worker.close();
  });

  it('should not clean anything if all jobs are in grace period', async () => {
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });

    const count1 = await queue.count();

    expect(count1).to.be.eql(2);

    const cleaned = await queue.clean(5000, 2, 'wait');
    expect(cleaned.length).to.be.eql(0);

    const cleaned2 = await queue.clean(5000, 2, 'wait');
    expect(cleaned2.length).to.be.eql(0);

    const count2 = await queue.count();

    expect(count2).to.be.eql(2);
  });

  it('should clean all failed jobs', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        await delay(100);
        throw new Error('It failed');
      },
      { connection, autorun: false },
    );
    await worker.waitUntilReady();

    await queue.addBulk([
      {
        name: 'test',
        data: { some: 'data' },
      },
      {
        name: 'test',
        data: { some: 'data' },
      },
    ]);

    const failing = new Promise(resolve => {
      queueEvents.on('failed', after(2, resolve));
    });

    worker.run();

    await failing;

    const jobs = await queue.clean(0, 0, 'failed');
    expect(jobs.length).to.be.eql(2);
    const count = await queue.count();
    expect(count).to.be.eql(0);

    await worker.close();
  });

  it('should clean all waiting jobs', async () => {
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await delay(100);
    const jobs = await queue.clean(0, 0, 'wait');
    expect(jobs.length).to.be.eql(2);
    const count = await queue.count();
    expect(count).to.be.eql(0);
  });

  describe('when delayed state is provided', async () => {
    it('cleans all delayed jobs', async () => {
      await queue.add('test', { some: 'data' }, { delay: 5000 });
      await queue.add('test', { some: 'data' }, { delay: 5000 });
      await delay(100);
      const jobs = await queue.clean(0, 0, 'delayed');
      expect(jobs.length).to.be.eql(2);
      const count = await queue.count();
      expect(count).to.be.eql(0);
    });

    it('does not clean anything if all jobs are in grace period', async () => {
      await queue.add('test', { some: 'data' }, { delay: 5000 });
      await queue.add('test', { some: 'data' }, { delay: 5000 });
      await delay(100);
      const jobs = await queue.clean(5000, 2, 'delayed');
      expect(jobs.length).to.be.eql(0);
      const count = await queue.count();
      expect(count).to.be.eql(2);
    });
  });

  describe('when creating a flow', async () => {
    describe('when parent belongs to same queue', async () => {
      describe('when parent has more than 1 pending children in the same queue', async () => {
        it('removes parent record', async () => {
          const name = 'child-job';

          const flow = new FlowProducer({ connection });
          await flow.add({
            name: 'parent-job',
            queueName,
            data: {},
            children: [
              { name, data: { idx: 0, foo: 'bar' }, queueName },
              { name, data: { idx: 1, foo: 'baz' }, queueName },
              { name, data: { idx: 2, foo: 'qux' }, queueName },
            ],
          });

          const count = await queue.count();
          expect(count).to.be.eql(4);

          await queue.clean(0, 0, 'wait');

          const client = await queue.client;
          const keys = await client.keys(`bull:${queue.name}:*`);

          expect(keys.length).to.be.eql(3);

          const countAfterEmpty = await queue.count();
          expect(countAfterEmpty).to.be.eql(0);

          const failedCount = await queue.getJobCountByTypes('failed');
          expect(failedCount).to.be.eql(0);
        });
      });

      describe('when parent has only 1 pending child in the same queue', async () => {
        it('deletes parent and its dependency keys', async () => {
          const name = 'child-job';

          let first = true;
          const worker = new Worker(
            queue.name,
            async () => {
              if (first) {
                first = false;
                throw new Error('failed first');
              }
              return delay(10);
            },
            { connection },
          );
          await worker.waitUntilReady();

          const completing = new Promise(resolve => {
            worker.on('completed', after(2, resolve));
          });

          const failing = new Promise(resolve => {
            worker.on('failed', resolve);
          });

          const flow = new FlowProducer({ connection });
          await flow.add({
            name: 'parent-job',
            queueName,
            data: {},
            children: [
              { name, data: { idx: 0, foo: 'bar' }, queueName },
              { name, data: { idx: 1, foo: 'baz' }, queueName },
              { name, data: { idx: 2, foo: 'qux' }, queueName },
            ],
          });

          await failing;
          await completing;
          await queue.clean(0, 0, 'failed');

          const client = await queue.client;
          const keys = await client.keys(`bull:${queue.name}:*`);

          expect(keys.length).to.be.eql(6);

          await worker.close();
        });
      });

      describe('when parent has pending children in different queue', async () => {
        it('keeps parent in waiting-children', async () => {
          const childrenQueueName = `test-${v4()}`;
          const childrenQueue = new Queue(childrenQueueName, { connection });
          await childrenQueue.waitUntilReady();
          const name = 'child-job';

          const flow = new FlowProducer({ connection });
          await flow.add({
            name: 'parent-job',
            queueName,
            data: {},
            children: [
              {
                name,
                data: { idx: 0, foo: 'bar' },
                queueName: childrenQueueName,
              },
            ],
          });

          const count = await queue.count();
          expect(count).to.be.eql(1);

          await queue.clean(0, 0, 'wait');

          const client = await queue.client;
          const keys = await client.keys(`bull:${queue.name}:*`);

          expect(keys.length).to.be.eql(6);

          const countAfterEmpty = await queue.count();
          expect(countAfterEmpty).to.be.eql(1);
        });
      });
    });

    describe('when parent belongs to different queue', async () => {
      describe('when parent has more than 1 pending children', async () => {
        it('deletes each children until trying to move parent to wait', async () => {
          const parentQueueName = `test-${v4()}`;
          const parentQueue = new Queue(parentQueueName, { connection });
          await parentQueue.waitUntilReady();
          const name = 'child-job';

          const flow = new FlowProducer({ connection });
          await flow.add({
            name: 'parent-job',
            queueName: parentQueueName,
            data: {},
            children: [
              { name, data: { idx: 0, foo: 'bar' }, queueName },
              { name, data: { idx: 1, foo: 'baz' }, queueName },
              { name, data: { idx: 2, foo: 'qux' }, queueName },
            ],
          });

          const count = await queue.count();
          expect(count).to.be.eql(3);

          await queue.clean(0, 0, 'wait');

          const client = await queue.client;
          const keys = await client.keys(`bull:${queueName}:*`);

          expect(keys.length).to.be.eql(3);

          const eventsCount = await client.xlen(
            `bull:${parentQueueName}:events`,
          );

          expect(eventsCount).to.be.eql(2); // added and waiting-children events

          const countAfterEmpty = await queue.count();
          expect(countAfterEmpty).to.be.eql(0);

          const childrenFailedCount = await queue.getJobCountByTypes('failed');
          expect(childrenFailedCount).to.be.eql(0);

          const parentWaitCount = await parentQueue.getJobCountByTypes('wait');
          expect(parentWaitCount).to.be.eql(1);
          await parentQueue.close();
          await removeAllQueueData(new IORedis(), parentQueueName);
        });
      });

      describe('when parent has only 1 pending children', async () => {
        it('moves parent to wait to try to process it', async () => {
          const parentQueueName = `test-${v4()}`;
          const parentQueue = new Queue(parentQueueName, { connection });
          await parentQueue.waitUntilReady();
          const name = 'child-job';

          const flow = new FlowProducer({ connection });
          await flow.add({
            name: 'parent-job',
            queueName: parentQueueName,
            data: {},
            children: [{ name, data: { idx: 0, foo: 'bar' }, queueName }],
          });

          const count = await queue.count();
          expect(count).to.be.eql(1);

          await queue.clean(0, 0, 'wait');

          const client = await queue.client;
          const keys = await client.keys(`bull:${queueName}:*`);

          expect(keys.length).to.be.eql(3);

          const countAfterEmpty = await queue.count();
          expect(countAfterEmpty).to.be.eql(0);

          const failedCount = await queue.getJobCountByTypes('failed');
          expect(failedCount).to.be.eql(0);

          const parentWaitCount = await parentQueue.getJobCountByTypes('wait');
          expect(parentWaitCount).to.be.eql(1);
          await parentQueue.close();
          await removeAllQueueData(new IORedis(), parentQueueName);
        });
      });
    });
  });

  it('should clean the number of jobs requested', async () => {
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await delay(100);
    const jobs = await queue.clean(0, 1, 'wait');
    expect(jobs.length).to.be.eql(1);
    const count = await queue.count();
    expect(count).to.be.eql(2);
  });

  it('should clean a job without a timestamp', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('It failed');
      },
      { connection },
    );
    await worker.waitUntilReady();

    const client = new IORedis();

    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });

    await delay(100);
    await client.hdel(`bull:${queueName}:1`, 'timestamp');
    const jobs = await queue.clean(0, 0, 'failed');
    expect(jobs.length).to.be.eql(2);
    const failed = await queue.getFailed();
    expect(failed.length).to.be.eql(0);

    await worker.close();
  });
});
