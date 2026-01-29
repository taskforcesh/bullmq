import { default as IORedis } from 'ioredis';
import { after } from 'lodash';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { v4 } from 'uuid';
import {
  FlowProducer,
  Queue,
  QueueEvents,
  WaitingChildrenError,
  Worker,
} from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Cleaner', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  let connection;
  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();
    await queue.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  it('should clean an empty queue', async () => {
    const waitCleaned = new Promise<void>(resolve => {
      queue.on('cleaned', (jobs, type) => {
        expect(type).toEqual('completed');
        expect(jobs.length).toEqual(0);
        resolve();
      });
    });

    const jobs = await queue.clean(0, 0);

    expect(jobs.length).toEqual(0);

    await waitCleaned;
  });

  it('should clean two jobs from the queue', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        await delay(10);
      },
      { connection, prefix },
    );
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
    await delay(10);

    const jobs = await queue.clean(0, 0);
    expect(jobs.length).toEqual(2);

    await worker.close();
  });

  it('should succeed when the limit is higher than the actual number of jobs', async () => {
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await delay(100);
    const deletedJobs = await queue.clean(0, 100, 'wait');
    expect(deletedJobs).toHaveLength(2);
    const remainingJobsCount = await queue.count();
    expect(remainingJobsCount).toEqual(0);
  });

  it('should only remove a job outside of the grace period', async () => {
    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
    });
    await worker.waitUntilReady();

    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await delay(200);
    await queue.add('test', { some: 'data' });
    await queue.clean(100, 100);
    await delay(100);
    const jobs = await queue.getCompleted();
    expect(jobs.length).toEqual(1);

    await worker.close();
  });

  it('should not clean anything if all jobs are in grace period', async () => {
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });

    const count1 = await queue.count();

    expect(count1).toEqual(2);

    const cleaned = await queue.clean(5000, 2, 'wait');
    expect(cleaned.length).toEqual(0);

    const cleaned2 = await queue.clean(5000, 2, 'wait');
    expect(cleaned2.length).toEqual(0);

    const count2 = await queue.count();

    expect(count2).toEqual(2);
  });

  it('should clean all failed jobs', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        await delay(100);
        throw new Error('It failed');
      },
      { connection, prefix, autorun: false },
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
    await delay(50);

    const jobs = await queue.clean(0, 0, 'failed');
    expect(jobs.length).toEqual(2);
    const count = await queue.count();
    expect(count).toEqual(0);

    await worker.close();
  });

  describe('when job scheduler is present', async () => {
    it('should clean all failed jobs', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
          throw new Error('It failed');
        },
        { connection, prefix, autorun: false },
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
      await queue.upsertJobScheduler('test-scheduler1', { every: 5000 });

      const failing = new Promise(resolve => {
        queueEvents.on('failed', after(3, resolve));
      });

      worker.run();

      await failing;
      await delay(50);

      const jobs = await queue.clean(0, 0, 'failed');
      expect(jobs.length).toEqual(3);
      const count = await queue.count();
      expect(count).toEqual(1);

      await worker.close();
    });

    it('should clean all completed jobs', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
        },
        { connection, prefix, autorun: false },
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
      await queue.upsertJobScheduler('test-scheduler1', { every: 5000 });

      const completing = new Promise(resolve => {
        queueEvents.on('completed', after(3, resolve));
      });

      worker.run();

      await completing;
      await delay(50);

      const jobs = await queue.clean(0, 0, 'completed');
      expect(jobs.length).toEqual(3);
      const count = await queue.count();
      expect(count).toEqual(1);

      await worker.close();
    });
  });

  it('should clean all waiting jobs', async () => {
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await delay(100);
    const jobs = await queue.clean(0, 0, 'wait');
    expect(jobs.length).toEqual(2);
    const count = await queue.count();
    expect(count).toEqual(0);
  });

  it('should clean all delayed jobs when limit is given', async () => {
    await queue.add('test', { some: 'data' }, { delay: 5000 });
    await queue.add('test', { some: 'data' }, { delay: 5000 });
    await delay(100);
    const jobs = await queue.clean(0, 1000, 'delayed');
    expect(jobs.length).toEqual(2);
    const count = await queue.count();
    expect(count).toEqual(0);
  });

  it('should clean all prioritized jobs when limit is given', async () => {
    await queue.add('test', { some: 'data' }, { priority: 5000 });
    await queue.add('test', { some: 'data' }, { priority: 5001 });
    await delay(100);
    const jobs = await queue.clean(0, 1000, 'prioritized');
    expect(jobs.length).toEqual(2);
    const count = await queue.count();
    expect(count).toEqual(0);
  });

  describe('when prioritized state is provided', async () => {
    it('should clean the number of jobs requested', async () => {
      await queue.add('test', { some: 'data' }, { priority: 1 }); // as queue is empty, this job will be added to wait
      await queue.add('test', { some: 'data' }, { priority: 2 });
      await queue.add('test', { some: 'data' }, { priority: 3 });
      await delay(100);
      const jobs = await queue.clean(0, 1, 'prioritized');
      expect(jobs.length).toEqual(1);
      const count = await queue.getJobCounts('prioritized');
      expect(count.prioritized).toEqual(2);
    });
  });

  describe('when delayed state is provided', async () => {
    it('cleans all delayed jobs', async () => {
      await queue.add('test', { some: 'data' }, { delay: 5000 });
      await queue.add('test', { some: 'data' }, { delay: 5000 });
      await delay(100);
      const jobs = await queue.clean(0, 0, 'delayed');
      expect(jobs.length).toEqual(2);
      const count = await queue.count();
      expect(count).toEqual(0);
    });

    it('does not clean anything if all jobs are in grace period', async () => {
      await queue.add('test', { some: 'data' }, { delay: 5000 });
      await queue.add('test', { some: 'data' }, { delay: 5000 });
      await delay(100);
      const jobs = await queue.clean(5000, 2, 'delayed');
      expect(jobs.length).toEqual(0);
      const count = await queue.count();
      expect(count).toEqual(2);
    });
  });

  describe('when creating a flow', async () => {
    describe('when parent belongs to same queue', async () => {
      describe('when parent has more than 1 pending children in the same queue', async () => {
        it('removes parent record', async () => {
          const name = 'child-job';

          const flow = new FlowProducer({ connection, prefix });
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
          expect(count).toEqual(4);

          await queue.clean(0, 0, 'wait');

          const client = await queue.client;
          const keys = await client.keys(`${prefix}:${queue.name}:*`);

          expect(keys.length).toEqual(4);
          for (const key of keys) {
            const type = key.split(':')[2];
            expect(['meta', 'events', 'marker', 'id']).toContain(type);
          }

          const countAfterEmpty = await queue.count();
          expect(countAfterEmpty).toEqual(0);

          const failedCount = await queue.getJobCountByTypes('failed');
          expect(failedCount).toEqual(0);
          await flow.close();
        });
      });

      describe('when parent has all processed children in the same queue', async () => {
        describe('when parent completes', async () => {
          it('deletes parent and its dependency keys', async () => {
            const name = 'child-job';

            const worker = new Worker(
              queue.name,
              async () => {
                return delay(20);
              },
              { connection, prefix },
            );
            await worker.waitUntilReady();

            const completing = new Promise(resolve => {
              queueEvents.on('completed', after(4, resolve));
            });

            const flow = new FlowProducer({ connection, prefix });
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
            await completing;
            await delay(100);
            await queue.clean(0, 0, 'completed');

            const client = await queue.client;
            const keys = await client.keys(`${prefix}:${queue.name}:*`);

            // Expected keys: meta, id, stalled-check and events
            expect(keys.length).toEqual(4);
            for (const key of keys) {
              const type = key.split(':')[2];
              expect(['meta', 'id', 'stalled-check', 'events']).toContain(type);
            }

            const jobs = await queue.getJobCountByTypes('completed');
            expect(jobs).toBe(0);

            await worker.close();
            await flow.close();
          });
        });

        describe('when parent fails', async () => {
          it('deletes parent dependencies and keeps parent', async () => {
            const name = 'child-job';

            const worker = new Worker(
              queue.name,
              async job => {
                if (job.data.idx === 3) {
                  throw new Error('error');
                }
                return delay(10);
              },
              { connection, prefix },
            );
            await worker.waitUntilReady();

            const failing = new Promise(resolve => {
              worker.on('failed', resolve);
            });

            const flow = new FlowProducer({ connection, prefix });
            const tree = await flow.add({
              name: 'parent-job',
              queueName,
              data: { idx: 3 },
              children: [
                { name, data: { idx: 0, foo: 'bar' }, queueName },
                { name, data: { idx: 1, foo: 'baz' }, queueName },
                { name, data: { idx: 2, foo: 'qux' }, queueName },
              ],
            });

            await failing;
            await queue.clean(0, 0, 'completed');

            const client = await queue.client;
            const keys = await client.keys(`${prefix}:${queue.name}:*`);

            const suffixes = keys.map(key => key.split(':')[2]);
            // Expected keys: meta, id, stalled-check, events, failed and job
            expect(suffixes).toEqual(
              expect.arrayContaining([
                'meta',
                'id',
                'stalled-check',
                'events',
                'failed',
                tree.job.id!,
              ]),
            );

            const parentState = await tree.job.getState();
            expect(parentState).toBe('failed');

            const job = queue.getJob(tree.job.id!);
            expect(job).toBeDefined();

            const jobs = await queue.getJobCountByTypes('completed');
            expect(jobs).toBe(0);

            await worker.close();
            await flow.close();
          });
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
            { connection, prefix },
          );
          await worker.waitUntilReady();

          const completing = new Promise(resolve => {
            worker.on('completed', after(2, resolve));
          });

          const failing = new Promise(resolve => {
            worker.on('failed', resolve);
          });

          const flow = new FlowProducer({ connection, prefix });
          const tree = await flow.add({
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
          // only checks if there are keys under job key prefix
          // this way we make sure that all of them were removed
          const keys = await client.keys(
            `${prefix}:${queue.name}:${tree.job.id}*`,
          );

          expect(keys.length).toEqual(0);

          const jobs = await queue.getJobCountByTypes('completed');
          expect(jobs).toBe(2);

          const parentState = await tree.job.getState();
          expect(parentState).toBe('unknown');

          await worker.close();
          await flow.close();
        });
      });

      describe('when parent has pending children in different queue', async () => {
        it('keeps parent in waiting-children', async () => {
          const childrenQueueName = `test-${v4()}`;
          const childrenQueue = new Queue(childrenQueueName, {
            connection,
            prefix,
          });
          await childrenQueue.waitUntilReady();
          const name = 'child-job';

          const flow = new FlowProducer({ connection, prefix });
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
          expect(count).toEqual(1);

          await queue.clean(0, 0, 'wait');

          const client = await queue.client;
          const keys = await client.keys(`${prefix}:${queue.name}:*`);

          expect(keys.length).toEqual(6);

          const countAfterEmpty = await queue.count();
          expect(countAfterEmpty).toEqual(1);

          await flow.close();
          await childrenQueue.close();
        });
      });

      describe('when creating children at runtime and call clean when parent is active', () => {
        it('does not delete parent record', async () => {
          // TODO: Move timeout to test options: { timeout: 4000 }

          enum Step {
            Initial,
            Second,
            Third,
            Finish,
          }

          const worker = new Worker(
            queueName,
            async (job, token) => {
              if (job.name === 'child') {
                await delay(100);
                throw new Error('forced child error');
              }
              let step = job.data.step;
              while (step !== Step.Finish) {
                switch (step) {
                  case Step.Initial: {
                    await queue.add(
                      'child',
                      { foo: 'bar' },
                      {
                        parent: {
                          id: job.id!,
                          queue: job.queueQualifiedName,
                        },
                        removeDependencyOnFailure: true,
                      },
                    );
                    await delay(1000);
                    await job.updateData({
                      step: Step.Second,
                    });
                    step = Step.Second;
                    break;
                  }
                  case Step.Second: {
                    await delay(100);
                    await job.updateData({
                      step: Step.Third,
                    });
                    step = Step.Third;
                    break;
                  }
                  case Step.Third: {
                    const shouldWait = await job.moveToWaitingChildren(token!);
                    if (!shouldWait) {
                      await job.updateData({
                        step: Step.Finish,
                      });
                      step = Step.Finish;
                      return Step.Finish;
                    } else {
                      throw new WaitingChildrenError();
                    }
                  }
                  default: {
                    throw new Error('invalid step');
                  }
                }
              }
            },
            { connection, prefix, concurrency: 2 },
          );
          await worker.waitUntilReady();

          const parent = await queue.add(
            'parent',
            { step: Step.Initial },
            {
              attempts: 3,
              backoff: 1000,
            },
          );

          await new Promise<void>(resolve => {
            worker.on('failed', async job => {
              await queue.clean(0, 0, 'failed');
              resolve();
            });
          });

          const job = await queue.getJob(parent.id!);
          expect(job).toBeDefined();

          const jobs = await queue.getJobCountByTypes('completed');
          expect(jobs).toBe(0);

          const parentState = await parent.getState();

          expect(parentState).toBe('active');

          await worker.close();
        });
      });
    });

    describe('when parent belongs to different queue', async () => {
      describe('when parent has more than 1 pending children', async () => {
        it('deletes each children until trying to move parent to wait', async () => {
          const parentQueueName = `test-${v4()}`;
          const parentQueue = new Queue(parentQueueName, {
            connection,
            prefix,
          });
          await parentQueue.waitUntilReady();
          const name = 'child-job';

          const flow = new FlowProducer({ connection, prefix });
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
          expect(count).toEqual(3);

          await queue.clean(0, 0, 'wait');

          const client = await queue.client;
          const keys = await client.keys(`${prefix}:${queueName}:*`);

          expect(keys.length).toEqual(4);
          for (const key of keys) {
            const type = key.split(':')[2];
            expect(['meta', 'events', 'marker', 'id']).toContain(type);
          }

          const eventsCount = await client.xlen(
            `${prefix}:${parentQueueName}:events`,
          );

          expect(eventsCount).toEqual(2); // added and waiting-children events

          const countAfterEmpty = await queue.count();
          expect(countAfterEmpty).toEqual(0);

          const childrenFailedCount = await queue.getJobCountByTypes('failed');
          expect(childrenFailedCount).toEqual(0);

          const parentWaitCount = await parentQueue.getJobCountByTypes('wait');
          expect(parentWaitCount).toEqual(1);
          await parentQueue.close();
          await flow.close();
          await removeAllQueueData(new IORedis(redisHost), parentQueueName);
        });
      });

      describe('when parent has only 1 pending children', async () => {
        it('moves parent to wait to try to process it', async () => {
          const parentQueueName = `test-${v4()}`;
          const parentQueue = new Queue(parentQueueName, {
            connection,
            prefix,
          });
          await parentQueue.waitUntilReady();
          const name = 'child-job';

          const flow = new FlowProducer({ connection, prefix });
          await flow.add({
            name: 'parent-job',
            queueName: parentQueueName,
            data: {},
            children: [
              {
                name,
                data: { idx: 0, foo: 'bar' },
                opts: { priority: 1 },
                queueName,
              },
            ],
          });

          const count = await queue.count();
          expect(count).toEqual(1);

          const priorityCount = await queue.getJobCounts('prioritized');
          expect(priorityCount.prioritized).toEqual(1);

          await queue.clean(0, 0, 'prioritized');

          const client = await queue.client;
          const keys = await client.keys(`${prefix}:${queueName}:*`);

          expect(keys.length).toEqual(5);

          const countAfterEmpty = await queue.count();
          expect(countAfterEmpty).toEqual(0);

          const failedCount = await queue.getJobCountByTypes('failed');
          expect(failedCount).toEqual(0);

          const parentWaitCount = await parentQueue.getJobCountByTypes('wait');
          expect(parentWaitCount).toEqual(1);
          await parentQueue.close();
          await flow.close();
          await removeAllQueueData(new IORedis(redisHost), parentQueueName);
        });
      });
    });
  });

  it('should clean a job without a timestamp', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('It failed');
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const client = new IORedis(redisHost);

    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });

    await delay(100);
    await client.hdel(`${prefix}:${queueName}:1`, 'timestamp');
    const jobs = await queue.clean(0, 0, 'failed');
    expect(jobs.length).toEqual(2);
    const failed = await queue.getFailed();
    expect(failed.length).toEqual(0);

    await worker.close();
  });

  // Test for wait vs waiting consistency fix
  it('should accept both "wait" and "waiting" in clean method', async () => {
    // Add some jobs to the queue
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });

    await delay(100);

    const counts = await queue.getJobCounts();
    expect(counts).toHaveProperty('waiting');
    expect(counts.waiting).toEqual(3);

    const cleanedWithWait = await queue.clean(0, 2, 'wait');
    expect(cleanedWithWait.length).toEqual(2);

    const remainingCount = await queue.count();
    expect(remainingCount).toEqual(1);

    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await delay(100);

    const cleanedWithWaiting = await queue.clean(0, 10, 'waiting');
    expect(cleanedWithWaiting.length).toEqual(3);

    const finalCount = await queue.count();
    expect(finalCount).toEqual(0);
  });

  it('should emit correct events for both "wait" and "waiting" clean operations', async () => {
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await delay(100);

    let cleanedEventFired = false;
    let cleanedType = '';
    let cleanedJobs: string[] = [];

    queue.on('cleaned', (jobs, type) => {
      cleanedEventFired = true;
      cleanedType = type;
      cleanedJobs = jobs;
    });

    await queue.clean(0, 1, 'wait');

    expect(cleanedEventFired).toBe(true);
    expect(cleanedType).toEqual('wait');
    expect(cleanedJobs.length).toEqual(1);

    cleanedEventFired = false;
    cleanedType = '';
    cleanedJobs = [];

    await queue.clean(0, 1, 'waiting');

    expect(cleanedEventFired).toBe(true);
    expect(cleanedType).toEqual('wait');
    expect(cleanedJobs.length).toEqual(1);
  });
});
