'use strict';

/**
 * Redis-only tests for `Job`.
 *
 * These exercise Redis-specific internals (raw job/dependency hashes, the
 * `:processed` set, deleting the meta key, low-level `addJob` with a client)
 * that have no backend-agnostic equivalent. They live in a dedicated
 * `*.redis.test.ts` suite excluded from the cross-backend runs.
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

import { Job, Queue, Worker } from '../src/classes';
import {
  delay,
  getParentKey,
  randomUUID,
  removeAllQueueData,
} from '../src/utils';
import { createTestConnection } from './utils/connection-factory';
import { IRedisClient } from '../src/interfaces';

describe('Job (redis-only)', () => {
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
  });

  afterEach(async () => {
    await queue.close();
    await removeAllQueueData(createTestConnection(), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('.remove', () => {
    it('removes processed hash', async () => {
      const client = await getRedisClient(queue);
      const values = [{ idx: 0, bar: 'something' }];
      const token = 'my-token';
      const token2 = 'my-token2';
      const parentQueueName = `parent-queue-${randomUUID()}`;

      const parentQueue = new Queue(parentQueueName, { connection, prefix });
      const parentWorker = new Worker(parentQueueName, null, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(queueName, null, {
        connection,
        prefix,
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const data = { foo: 'bar' };
      const parent = await Job.create(parentQueue, 'testParent', data);
      await Job.create(queue, 'testJob1', values[0], {
        parent: { id: parent.id, queue: `${prefix}:${parentQueueName}` },
      });

      const job = (await parentWorker.getNextJob(token)) as Job;
      const child1 = (await childrenWorker.getNextJob(token2)) as Job;

      const isActive = await job.isActive();
      expect(isActive).toBe(true);

      await child1.moveToCompleted('return value', token2);

      const parentId = job.id;
      await job.moveToCompleted('return value', token);
      await job.remove();

      const storedJob = await Job.fromId(parentQueue, job.id);
      expect(storedJob).toBe(undefined);

      const processed = await client.hgetall(
        `${prefix}:${parentQueueName}:${parentId}:processed`,
      );

      expect(processed).toEqual({});

      await childrenWorker.close();
      await parentWorker.close();
      await parentQueue.close();
      await removeAllQueueData(createTestConnection(), parentQueueName);
    });
  });

  describe('.moveToCompleted', () => {
    /**
     * Verify moveToFinished use default value for opts.maxLenEvents
     * if it does not exist in meta key (or entire meta key is missing).
     */
    it('should not fail if queue meta key is missing', async () => {
      const worker = new Worker(queueName, null, { connection, prefix });
      const token = 'my-token';
      await Job.create(queue, 'test', { color: 'red' });
      const job = (await worker.getNextJob(token)) as Job;
      const client = await getRedisClient(queue);
      await client.del(queue.toKey('meta'));
      await job.moveToCompleted('done', '0', false);
      const state = await job.getState();
      expect(state).toBe('completed');
      await worker.close();
    });

    it('should not complete a parent job before its children', async () => {
      const values = [
        { idx: 0, bar: 'something' },
        { idx: 1, baz: 'something' },
      ];
      const token = 'my-token';

      const parentQueueName = `parent-queue-${randomUUID()}`;

      const parentQueue = new Queue(parentQueueName, { connection, prefix });

      const parentWorker = new Worker(parentQueueName, null, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(queueName, null, {
        connection,
        prefix,
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const data = { foo: 'bar' };
      const parent = await Job.create(parentQueue, 'testParent', data);
      const parentKey = getParentKey({
        id: parent.id!,
        queue: `${prefix}:${parentQueueName}`,
      });
      const client = await getRedisClient(queue);
      const child1 = new Job(queue, 'testJob1', values[0]);
      await child1.addJob(client, {
        parentKey,
        parentDependenciesKey: `${parentKey}:dependencies`,
      });
      await Job.create(queue, 'testJob2', values[1], {
        parent: {
          id: parent.id!,
          queue: `${prefix}:${parentQueueName}`,
        },
      });

      const job = (await parentWorker.getNextJob(token)) as Job;
      const { unprocessed } = await parent.getDependencies();

      expect(unprocessed).toHaveLength(2);

      const isActive = await job.isActive();
      expect(isActive).toBe(true);

      await expect(job.moveToCompleted('return value', token)).rejects.toThrow(
        `Job ${job.id} has pending dependencies. moveToFinished`,
      );

      const lock = await client.get(
        `${prefix}:${parentQueueName}:${job.id}:lock`,
      );

      expect(lock).toBe(token);

      const isCompleted = await job.isCompleted();

      expect(isCompleted).toBe(false);

      await childrenWorker.close();
      await parentWorker.close();
      await parentQueue.close();
      await removeAllQueueData(createTestConnection(), parentQueueName);
    });
  });

  describe('.moveToFailed', () => {
    describe('when job is removed', () => {
      it('should not save stacktrace', async () => {
        const client = await getRedisClient(queue);
        const worker = new Worker(queueName, null, {
          connection,
          prefix,
          lockDuration: 100,
          skipLockRenewal: true,
        });
        const token = 'my-token';
        await Job.create(queue, 'test', { foo: 'bar' }, { attempts: 1 });
        const job = (await worker.getNextJob(token)) as Job;
        await delay(105);
        await job.remove();

        await expect(
          job.moveToFailed(new Error('test error'), '0'),
        ).rejects.toThrow(`Missing key for job ${job.id}. moveToFinished`);

        const processed = await client.hgetall(
          `${prefix}:${queueName}:${job.id}`,
        );

        expect(processed).toEqual({});

        await worker.close();
      });
    });
  });
});
