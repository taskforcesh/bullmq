import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { after } from 'lodash';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { Queue, QueueEvents, FlowProducer, Worker } from '../classes';
import { delay, removeAllQueueData } from '../utils';

describe('Obliterate', function() {
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName);
    queueEvents = new QueueEvents(queueName);
    await queueEvents.waitUntilReady();
  });

  afterEach(async function() {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should obliterate an empty queue', async () => {
    await queue.waitUntilReady();

    await queue.obliterate();

    const client = await queue.client;
    const keys = await client.keys(`bull:${queue.name}:*`);

    expect(keys.length).to.be.eql(0);
  });

  it('should obliterate a queue with jobs in different statuses', async () => {
    await queue.waitUntilReady();

    await queue.add('test', { foo: 'bar' });
    await queue.add('test', { foo: 'bar2' });
    await queue.add('test', { foo: 'bar3' }, { delay: 5000 });
    const job = await queue.add('test', { qux: 'baz' });

    let first = true;
    const worker = new Worker(queue.name, async job => {
      if (first) {
        first = false;
        throw new Error('failed first');
      }
      return delay(250);
    });
    await worker.waitUntilReady();

    await job.waitUntilFinished(queueEvents);

    await queue.obliterate();
    const client = await queue.client;
    const keys = await client.keys(`bull:${queue.name}:*`);
    expect(keys.length).to.be.eql(0);

    await worker.close();
  });

  describe('when creating a flow', async () => {
    it('obliterates a queue with jobs and its dependency keys', async () => {
      await queue.waitUntilReady();
      const name = 'child-job';

      let first = true;
      const worker = new Worker(queue.name, async job => {
        if (first) {
          first = false;
          throw new Error('failed first');
        }
        return delay(10);
      });
      await worker.waitUntilReady();

      const completing = new Promise((resolve, reject) => {
        worker.on('completed', after(2, resolve));
      });

      const failing = new Promise((resolve, reject) => {
        worker.on('failed', resolve);
      });

      const flow = new FlowProducer();
      await flow.add({
        name: 'parent-job',
        queueName: queueName,
        data: {},
        children: [
          { name, data: { idx: 0, foo: 'bar' }, queueName },
          { name, data: { idx: 1, foo: 'baz' }, queueName },
          { name, data: { idx: 2, foo: 'qux' }, queueName },
        ],
      });

      await failing;
      await completing;
      await queue.obliterate();

      const client = await queue.client;
      const keys = await client.keys(`bull:${queue.name}:*`);

      expect(keys.length).to.be.eql(0);

      await worker.close();
    });
  });

  it('should raise exception if queue has active jobs', async () => {
    await queue.waitUntilReady();

    await queue.add('test', { foo: 'bar' });
    const job = await queue.add('test', { qux: 'baz' });

    await queue.add('test', { foo: 'bar2' });
    await queue.add('test', { foo: 'bar3' }, { delay: 5000 });

    let first = true;
    const worker = new Worker(queue.name, async job => {
      if (first) {
        first = false;
        throw new Error('failed first');
      }
      return delay(250);
    });
    await worker.waitUntilReady();

    await job.waitUntilFinished(queueEvents);

    await expect(queue.obliterate()).to.be.rejectedWith(
      'Cannot obliterate queue with active jobs',
    );
    const client = await queue.client;
    const keys = await client.keys(`bull:${queue.name}:*`);
    expect(keys.length).to.be.not.eql(0);

    await worker.close();
  });

  it('should obliterate if queue has active jobs using "force"', async () => {
    await queue.waitUntilReady();

    await queue.add('test', { foo: 'bar' });
    const job = await queue.add('test', { qux: 'baz' });

    await queue.add('test', { foo: 'bar2' });
    await queue.add('test', { foo: 'bar3' }, { delay: 5000 });

    let first = true;
    const worker = new Worker(queue.name, async job => {
      if (first) {
        first = false;
        throw new Error('failed first');
      }
      return delay(250);
    });
    await worker.waitUntilReady();

    await job.waitUntilFinished(queueEvents);
    await queue.obliterate({ force: true });
    const client = await queue.client;
    const keys = await client.keys(`bull:${queue.name}:*`);
    expect(keys.length).to.be.eql(0);

    await worker.close();
  });

  it('should remove repeatable jobs', async () => {
    await queue.waitUntilReady();

    await queue.add(
      'test',
      { foo: 'bar' },
      {
        repeat: {
          every: 1000,
        },
      },
    );

    const repeatableJobs = await queue.getRepeatableJobs();
    expect(repeatableJobs).to.have.length(1);

    await queue.obliterate();
    const client = await queue.client;
    const keys = await client.keys(`bull:${queue.name}:*`);
    expect(keys.length).to.be.eql(0);
  });

  it('should remove job logs', async () => {
    const job = await queue.add('test', {});

    const queueEvents = new QueueEvents(queue.name);

    const worker = new Worker(queue.name, async job => {
      return job.log('Lorem Ipsum Dolor Sit Amet');
    });
    await worker.waitUntilReady();

    await job.waitUntilFinished(queueEvents);

    await queue.obliterate({ force: true });

    const { logs } = await queue.getJobLogs(job.id);
    expect(logs).to.have.length(0);
  });

  it('should obliterate a queue with high number of jobs in different statuses', async function() {
    this.timeout(6000);
    const arr1 = [];
    for (let i = 0; i < 300; i++) {
      arr1.push(queue.add('test', { foo: `barLoop${i}` }));
    }

    const [lastCompletedJob] = (await Promise.all(arr1)).splice(-1);

    let fail = false;
    const worker = new Worker(queue.name, async job => {
      if (fail) {
        throw new Error('failed job');
      }
    });
    await worker.waitUntilReady();

    await lastCompletedJob.waitUntilFinished(queueEvents);

    fail = true;

    const arr2 = [];
    for (let i = 0; i < 300; i++) {
      arr2.push(queue.add('test', { foo: `barLoop${i}` }));
    }

    const [lastFailedJob] = (await Promise.all(arr2)).splice(-1);

    await expect(
      lastFailedJob.waitUntilFinished(queueEvents),
    ).to.be.eventually.rejectedWith('failed job');

    const arr3 = [];
    for (let i = 0; i < 1623; i++) {
      arr3.push(queue.add('test', { foo: `barLoop${i}` }, { delay: 10000 }));
    }
    await Promise.all(arr3);

    await queue.obliterate();
    const client = await queue.client;
    const keys = await client.keys(`bull:${queue.name}*`);
    expect(keys.length).to.be.eql(0);

    await worker.close();
  });
});
