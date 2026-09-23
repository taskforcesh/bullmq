/**
 * Redis-only delayed-job tests.
 *
 * These assert on the raw Redis keyspace — specifically the `marker` key the
 * Redis backend uses to wake blocked workers — which has no backend-agnostic
 * equivalent. The portable delayed-job behaviour lives in `delay.test.ts`.
 */
import { getRedisClient } from './utils/get-redis-client';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { Queue, Worker, QueueEvents } from '../src/classes';
import { delay, randomUUID, removeAllQueueData } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';
import { IRedisClient } from '../src/interfaces';

describe('Delayed jobs (redis-only)', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;

  let connection: IRedisClient;
  beforeAll(async () => {
    connection = createTestConnection();
  });

  beforeEach(async () => {
    queueName = `test-${randomUUID()}`;
    queue = new Queue(queueName, { connection, prefix });
    await queue.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await removeAllQueueData(createTestConnection(), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('when markers are deleted', () => {
    it('should process a delayed job without getting stuck', async () => {
      const delayTime = 6000;
      const margin = 1.2;

      const queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();

      const worker = new Worker(queueName, async () => {}, {
        connection,
        autorun: false,
        prefix,
      });
      await worker.waitUntilReady();

      const timestamp = Date.now();
      let publishHappened = false;

      const delayed = new Promise<void>(resolve => {
        queueEvents.on('delayed', () => {
          publishHappened = true;
          resolve();
        });
      });

      const completed = new Promise<void>((resolve, reject) => {
        worker.on('completed', async function (job) {
          try {
            expect(Date.now() > timestamp + delayTime);
            expect(job.processedOn! - job.timestamp).toBeGreaterThanOrEqual(
              delayTime,
            );
            expect(
              job.processedOn! - job.timestamp,
              'processedOn is not within margin',
            ).toBeLessThan(delayTime * margin);

            const jobs = await queue.getWaiting();
            expect(jobs.length).toBe(0);

            const delayedJobs = await queue.getDelayed();
            expect(delayedJobs.length).toBe(0);
            expect(publishHappened).toEqual(true);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      const job = await queue.add(
        'test',
        { delayed: 'foobar' },
        { delay: delayTime },
      );

      expect(job.id).toBeTruthy();
      expect(job.data.delayed).toEqual('foobar');
      expect(job.opts.delay).toEqual(delayTime);
      expect(job.delay).toEqual(delayTime);

      await delayed;

      const client = await getRedisClient(queue);
      await client.del(queue.toKey('marker'));

      worker.run();

      await delay(2000);

      await client.del(queue.toKey('marker'));

      await completed;
      await queueEvents.close();
      await worker.close();
    });
  });
});
