import { default as IORedis } from 'ioredis';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { after } from 'lodash';
import * as sinon from 'sinon';
import { v4 } from 'uuid';
import { FlowProducer, Job, Queue, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';
import { version as currentPackageVersion } from '../src/version';

describe('queues', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  const sandbox = sinon.createSandbox();

  let queue: Queue;
  let queueName: string;

  let connection: IORedis;
  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    await queue.waitUntilReady();
  });

  afterEach(async () => {
    sandbox.restore();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('use generics', () => {
    it('should be able to use generics', async () => {
      const queue = new Queue<{ foo: string; bar: number }>(queueName, {
        prefix,
        connection,
      });

      const job = await queue.add(queueName, { foo: 'bar', bar: 1 });
      const job2 = await queue.getJob(job.id!);
      expect(job2?.data.foo).toEqual('bar');
      expect(job2?.data.bar).toEqual(1);
      await queue.close();
    });

    it('should resolve Job<any, any, string> when no generics provided', async () => {
      await queue.add('test-job', { foo: 'bar', num: 123 });

      const jobs = await queue.getJobs(['waiting']);

      expect(jobs).toBeInstanceOf(Array);
      expect(jobs.length).toBeGreaterThanOrEqual(1);
      expect(jobs[0]).toBeInstanceOf(Job);
    });
  });

  describe('when removing a job', () => {
    it('should emit removed event', async () => {
      const queue = new Queue<{ foo: string; bar: number }>(queueName, {
        prefix,
        connection,
      });

      const job = await queue.add(queueName, { foo: 'bar', bar: 1 });
      const removed = new Promise<void>(resolve => {
        queue.on('removed', (jobId: string) => {
          expect(jobId).toEqual(job.id);
          resolve();
        });
      });
      queue.remove(job.id!);
      await removed;
      await queue.close();
    });
  });

  it('should return the queue version', async () => {
    const queue = new Queue(queueName, { connection });
    const version = await queue.getVersion();
    expect(version.startsWith('bullmq')).toBe(true);
    expect(version.endsWith(`:${currentPackageVersion}`)).toBe(true);
    return queue.close();
  });

  it('should return default library version when using skipMetasUpdate', async () => {
    const exQueueName = `test-${v4()}`;
    const queue = new Queue(exQueueName, { connection, skipMetasUpdate: true });
    const version = await queue.getVersion();
    expect(version).toBe(null);
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), exQueueName);
  });

  describe('.getMeta', () => {
    it('should return global concurrency', async () => {
      await queue.setGlobalConcurrency(1);
      const config = await queue.getMeta();

      expect(config).toMatchObject({
        maxLenEvents: 10000,
        paused: false,
        concurrency: 1,
      });
      expect(config.version?.startsWith('bullmq')).toBe(true);
      expect(config.version?.endsWith(`:${currentPackageVersion}`)).toBe(true);

      await queue.close();
    });

    it('should return global rate limit', async () => {
      await queue.setGlobalRateLimit(1, 500);
      const config = await queue.getMeta();

      expect(config).toMatchObject({
        maxLenEvents: 10000,
        paused: false,
        max: 1,
        duration: 500,
      });
      expect(config.version?.startsWith('bullmq')).toBe(true);
      expect(config.version?.endsWith(`:${currentPackageVersion}`)).toBe(true);

      await queue.close();
    });

    it('should return paused', async () => {
      await queue.pause();
      const config = await queue.getMeta();

      expect(config).toMatchObject({
        maxLenEvents: 10000,
        paused: true,
      });
      expect(config.version?.startsWith('bullmq')).toBe(true);
      expect(config.version?.endsWith(`:${currentPackageVersion}`)).toBe(true);

      await queue.close();
    });
  });

  describe('.add', () => {
    describe('when jobId is provided as integer', () => {
      it('throws error', async () => {
        await expect(
          queue.add('test', { foo: 1 }, { jobId: '2' }),
        ).rejects.toThrow('Custom Id cannot be integers');
      });
    });

    describe('when custom job id contains :', () => {
      it('throws an error', async () => {
        await expect(
          queue.add('test', { foo: 1 }, { jobId: '1:0' }),
        ).rejects.toThrow('Custom Id cannot contain :');
      });
    });
  });

  describe('when queue name contains :', () => {
    it('throws an error', async () => {
      expect(
        () =>
          new Queue('name:test', {
            connection,
            prefix,
          }),
      ).toThrow('Queue name cannot contain :');
    });
  });

  describe('when empty name is provided', () => {
    it('throws an error', async () => {
      expect(
        () =>
          new Queue('', {
            connection,
            prefix,
          }),
      ).toThrow('Queue name must be provided');
    });
  });

  describe('.drain', () => {
    it('count added, unprocessed jobs', async () => {
      const maxJobs = 100;
      const added: Promise<Job<any, any, string>>[] = [];

      for (let i = 1; i <= maxJobs; i++) {
        added.push(queue.add('test', { foo: 'bar', num: i }, { priority: i }));
      }
      await Promise.all(added);

      const count = await queue.count();
      expect(count).toEqual(maxJobs);
      const priorityCount = await queue.getJobCountByTypes('prioritized');
      expect(priorityCount).toEqual(maxJobs);

      await queue.drain();
      const countAfterEmpty = await queue.count();
      expect(countAfterEmpty).toEqual(0);

      const client = await queue.client;
      const keys = await client.keys(`${prefix}:${queue.name}:*`);
      expect(keys.length).toEqual(5);

      for (const key of keys) {
        const type = key.split(':')[2];
        expect(['marker', 'events', 'meta', 'pc', 'id']).toContain(type);
      }
    }); // TODO: Add { timeout: 10000 } to the it() options

    describe('when having a flow', async () => {
      describe('when parent belongs to same queue', async () => {
        describe('when parent has more than 1 pending children in the same queue', async () => {
          it('deletes parent record', async () => {
            await queue.waitUntilReady();
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

            await queue.drain();

            const client = await queue.client;
            const keys = await client.keys(`${prefix}:${queue.name}:*`);

            expect(keys.length).toEqual(4);
            for (const key of keys) {
              const type = key.split(':')[2];
              expect(['events', 'meta', 'id', 'marker']).toContain(type);
            }

            const countAfterEmpty = await queue.count();
            expect(countAfterEmpty).toEqual(0);

            await flow.close();
          });
        });

        describe('when parent has only 1 pending child in the same queue', async () => {
          it('deletes parent record', async () => {
            await queue.waitUntilReady();
            const name = 'child-job';

            const flow = new FlowProducer({ connection, prefix });
            await flow.add({
              name: 'parent-job',
              queueName,
              data: {},
              children: [{ name, data: { idx: 0, foo: 'bar' }, queueName }],
            });

            const count = await queue.count();
            expect(count).toEqual(2);

            await queue.drain();

            const client = await queue.client;
            const keys = await client.keys(`${prefix}:${queue.name}:*`);

            expect(keys.length).toEqual(4);
            for (const key of keys) {
              const type = key.split(':')[2];
              expect(['id', 'meta', 'marker', 'events']).toContain(type);
            }

            const countAfterEmpty = await queue.count();
            expect(countAfterEmpty).toEqual(0);

            await flow.close();
          });
        });

        describe('when parent has pending children in different queue', async () => {
          it('keeps parent in waiting-children', async () => {
            await queue.waitUntilReady();
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

            await queue.drain();

            const client = await queue.client;
            const keys = await client.keys(`${prefix}:${queue.name}:*`);

            expect(keys.length).toEqual(6);

            const countAfterEmpty = await queue.count();
            expect(countAfterEmpty).toEqual(1);

            await flow.close();
            await childrenQueue.close();
          });
        });
      });

      describe('when parent belongs to different queue', async () => {
        describe('when parent has more than 1 pending children', async () => {
          it('deletes each children until trying to move parent to wait', async () => {
            await queue.waitUntilReady();
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

            await queue.drain();

            const client = await queue.client;
            const keys = await client.keys(`${prefix}:${queue.name}:*`);

            expect(keys.length).toEqual(4);
            for (const key of keys) {
              const type = key.split(':')[2];
              expect(['id', 'meta', 'events', 'marker']).toContain(type);
            }

            const countAfterEmpty = await queue.count();
            expect(countAfterEmpty).toEqual(0);

            const childrenFailedCount =
              await queue.getJobCountByTypes('failed');
            expect(childrenFailedCount).toEqual(0);

            const parentWaitCount =
              await parentQueue.getJobCountByTypes('wait');
            expect(parentWaitCount).toEqual(1);
            await parentQueue.close();
            await flow.close();
            await removeAllQueueData(new IORedis(redisHost), parentQueueName);
          });
        });

        describe('when parent has only 1 pending children', async () => {
          it('moves parent to wait to try to process it', async () => {
            await queue.waitUntilReady();
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
              children: [{ name, data: { idx: 0, foo: 'bar' }, queueName }],
            });

            const count = await queue.count();
            expect(count).toEqual(1);

            await queue.drain();

            const client = await queue.client;
            const keys = await client.keys(`${prefix}:${queue.name}:*`);

            expect(keys.length).toEqual(4);
            for (const key of keys) {
              const type = key.split(':')[2];
              expect(['id', 'meta', 'events', 'marker']).toContain(type);
            }

            const countAfterEmpty = await queue.count();
            expect(countAfterEmpty).toEqual(0);

            const failedCount = await queue.getJobCountByTypes('failed');
            expect(failedCount).toEqual(0);

            const parentWaitCount =
              await parentQueue.getJobCountByTypes('wait');
            expect(parentWaitCount).toEqual(1);
            await parentQueue.close();
            await flow.close();
            await removeAllQueueData(new IORedis(redisHost), parentQueueName);
          });
        });
      });
    });

    describe('when delayed option is provided as false', () => {
      it('clean queue without delayed jobs', async () => {
        const maxJobs = 50;
        const maxDelayedJobs = 50;
        const added: Promise<Job>[] = [];
        const delayed: Promise<Job>[] = [];

        for (let i = 1; i <= maxJobs; i++) {
          added.push(queue.add('test', { foo: 'bar', num: i }));
        }

        for (let i = 1; i <= maxDelayedJobs; i++) {
          delayed.push(
            queue.add('test', { foo: 'bar', num: i }, { delay: 10000 }),
          );
        }

        await Promise.all(added);
        await Promise.all(delayed);
        const count = await queue.count();
        expect(count).toEqual(maxJobs + maxDelayedJobs);
        await queue.drain(false);
        const countAfterEmpty = await queue.count();
        expect(countAfterEmpty).toEqual(50);
      });
    });

    describe('when delayed option is provided as true', () => {
      it('clean queue including delayed jobs', async () => {
        const maxJobs = 50;
        const maxDelayedJobs = 50;
        const added: Promise<Job>[] = [];
        const delayed: Promise<Job>[] = [];

        for (let i = 1; i <= maxJobs; i++) {
          added.push(queue.add('test', { foo: 'bar', num: i }));
        }

        for (let i = 1; i <= maxDelayedJobs; i++) {
          delayed.push(
            queue.add('test', { foo: 'bar', num: i }, { delay: 10000 }),
          );
        }

        await Promise.all(added);
        await Promise.all(delayed);
        const count = await queue.count();
        expect(count).toEqual(maxJobs + maxDelayedJobs);
        await queue.drain(true);
        const countAfterEmpty = await queue.count();
        expect(countAfterEmpty).toEqual(0);
      });
    });

    describe('when queue is paused', () => {
      it('clean queue including paused jobs', async () => {
        const maxJobs = 50;
        const added: Promise<Job>[] = [];

        await queue.pause();
        for (let i = 1; i <= maxJobs; i++) {
          added.push(queue.add('test', { foo: 'bar', num: i }));
        }

        await Promise.all(added);
        const count = await queue.count();
        expect(count).toEqual(maxJobs);
        const count2 = await queue.getJobCounts('paused');
        expect(count2.paused).toEqual(maxJobs);
        await queue.drain();
        const countAfterEmpty = await queue.count();
        expect(countAfterEmpty).toEqual(0);
      });
    });
  });

  describe('.removeDeprecatedPriorityKey', () => {
    it('removes old priority key', async () => {
      const client = await queue.client;
      await client.zadd(`${prefix}:${queue.name}:priority`, 1, 'a');
      await client.zadd(`${prefix}:${queue.name}:priority`, 2, 'b');

      const count = await client.zcard(`${prefix}:${queue.name}:priority`);

      expect(count).toEqual(2);

      await queue.removeDeprecatedPriorityKey();

      const updatedCount = await client.zcard(
        `${prefix}:${queue.name}:priority`,
      );

      expect(updatedCount).toEqual(0);
    });
  });

  describe('.retryJobs', () => {
    it('retries all failed jobs by default', async () => {
      await queue.waitUntilReady();
      const jobCount = 8;

      let fail = true;
      const worker = new Worker(
        queueName,
        async () => {
          await delay(10);
          if (fail) {
            throw new Error('failed');
          }
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      let order = 0;
      const failing = new Promise<void>(resolve => {
        worker.on('failed', job => {
          expect(order).toEqual(job!.data.idx);
          if (order === jobCount - 1) {
            resolve();
          }
          order++;
        });
      });

      for (const index of Array.from(Array(jobCount).keys())) {
        await queue.add('test', { idx: index });
      }

      await failing;

      const failedCount = await queue.getJobCounts('failed');
      expect(failedCount.failed).toBe(jobCount);

      order = 0;
      const completing = new Promise<void>(resolve => {
        worker.on('completed', job => {
          expect(order).toEqual(job.data.idx);
          if (order === jobCount - 1) {
            resolve();
          }
          order++;
        });
      });

      fail = false;
      await queue.retryJobs({ count: 2 });

      await completing;

      const completedCount = await queue.getJobCounts('completed');
      expect(completedCount.completed).toBe(jobCount);

      await worker.close();
    });

    describe('when completed state is provided', () => {
      it('retries all completed jobs', async () => {
        await queue.waitUntilReady();
        const jobCount = 8;

        const worker = new Worker(
          queueName,
          async () => {
            await delay(25);
          },
          { connection, prefix },
        );
        await worker.waitUntilReady();

        const completing1 = new Promise(resolve => {
          worker.on('completed', after(jobCount, resolve));
        });

        const jobs = Array.from(Array(jobCount).keys()).map(index => ({
          name: 'test',
          data: { idx: index },
        }));
        await queue.addBulk(jobs);

        await completing1;

        const completedCount1 = await queue.getJobCounts('completed');
        expect(completedCount1.completed).toBe(jobCount);

        const completing2 = new Promise(resolve => {
          worker.on('completed', after(jobCount, resolve));
        });

        await queue.retryJobs({ count: 2, state: 'completed' });

        const completedCount2 = await queue.getJobCounts('completed');
        expect(completedCount2.completed).toBe(0);

        await completing2;

        const completedCount = await queue.getJobCounts('completed');
        expect(completedCount.completed).toBe(jobCount);

        await worker.close();
      });
    });

    describe('when timestamp is provided', () => {
      it('should retry all failed jobs before specific timestamp', async () => {
        await queue.waitUntilReady();
        const jobCount = 8;

        let fail = true;
        const worker = new Worker(
          queueName,
          async () => {
            await delay(50);
            if (fail) {
              throw new Error('failed');
            }
          },
          { connection, prefix },
        );
        await worker.waitUntilReady();

        let order = 0;
        let timestamp;
        const failing = new Promise<void>(resolve => {
          worker.on('failed', job => {
            expect(order).toEqual(job!.data.idx);
            if (job!.data.idx === jobCount / 2 - 1) {
              timestamp = Date.now();
            }
            if (order === jobCount - 1) {
              resolve();
            }
            order++;
          });
        });

        for (const index of Array.from(Array(jobCount).keys())) {
          await queue.add('test', { idx: index });
        }

        await failing;

        const failedCount = await queue.getJobCounts('failed');
        expect(failedCount.failed).toBe(jobCount);

        order = 0;
        const completing = new Promise<void>(resolve => {
          worker.on('completed', job => {
            expect(order).toEqual(job.data.idx);
            if (order === jobCount / 2 - 1) {
              resolve();
            }
            order++;
          });
        });

        fail = false;

        await queue.retryJobs({ count: 2, timestamp });
        await completing;

        const count = await queue.getJobCounts('completed', 'failed');
        expect(count.completed).toBe(jobCount / 2);
        expect(count.failed).toBe(jobCount / 2);

        await worker.close();
      });
    });

    describe('when queue is paused', () => {
      it('moves retried jobs to paused', async () => {
        await queue.waitUntilReady();
        const jobCount = 8;

        let fail = true;
        const worker = new Worker(
          queueName,
          async () => {
            await delay(10);
            if (fail) {
              throw new Error('failed');
            }
          },
          { connection, prefix },
        );
        await worker.waitUntilReady();

        let order = 0;
        const failing = new Promise<void>(resolve => {
          worker.on('failed', job => {
            expect(order).toEqual(job!.data.idx);
            if (order === jobCount - 1) {
              resolve();
            }
            order++;
          });
        });

        for (const index of Array.from(Array(jobCount).keys())) {
          await queue.add('test', { idx: index });
        }

        await failing;

        const failedCount = await queue.getJobCounts('failed');
        expect(failedCount.failed).toBe(jobCount);

        order = 0;

        fail = false;
        await queue.pause();
        await queue.retryJobs({ count: 2 });

        const pausedCount = await queue.getJobCounts('paused');
        expect(pausedCount.paused).toBe(jobCount);

        await worker.close();
      });
    });
  });

  describe('.promoteJobs', () => {
    it('promotes all delayed jobs by default', async () => {
      await queue.waitUntilReady();
      const jobCount = 8;

      for (let i = 0; i < jobCount; i++) {
        await queue.add('test', { idx: i }, { delay: 10000 });
      }

      const delayedCount = await queue.getJobCounts('delayed');
      expect(delayedCount.delayed).toBe(jobCount);

      await queue.promoteJobs();

      const waitingCount = await queue.getJobCounts('waiting');
      expect(waitingCount.waiting).toBe(jobCount);

      const worker = new Worker(
        queueName,
        async () => {
          await delay(10);
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const completing = new Promise<number>(resolve => {
        worker.on('completed', after(jobCount, resolve));
      });

      await completing;

      const promotedCount = await queue.getJobCounts('delayed');
      expect(promotedCount.delayed).toBe(0);

      await worker.close();
    });
  });
});
