/**
 * Redis-only Cleaner tests.
 *
 * `removeOrphanedJobs` operates on the Redis keyspace — job hashes (and their
 * sub-keys) that exist but are not referenced by any state set. On PostgreSQL a
 * job is a single relational row inserted transactionally with its state, so
 * orphans cannot exist and `removeOrphanedJobs` is a no-op. These tests build
 * raw orphaned hashes/sub-keys directly, so they are scoped to Redis. The
 * backend-agnostic cases (returns 0, never touches real jobs) live in
 * `clean.test.ts` and run on both backends.
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

import { Queue, QueueEvents, Worker } from '../src/classes';
import { delay, randomUUID, removeAllQueueData } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';
import { IRedisClient } from '../src/interfaces';

describe('Cleaner (redis-only)', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  let connection: IRedisClient;
  beforeAll(async () => {
    connection = createTestConnection();
  });

  beforeEach(async () => {
    queueName = `test-${randomUUID()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();
    await queue.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(createTestConnection(), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('removeOrphanedJobs', () => {
    it('should remove orphaned job hashes with no sub-keys', async () => {
      const client = await getRedisClient(queue);
      const baseKey = `${prefix}:${queue.name}`;

      const orphanedIds = ['9990', '9991', '9992'];
      for (const id of orphanedIds) {
        await client.hset(`${baseKey}:${id}`, { name: 'orphaned', data: '{}' });
      }

      const removed = await queue.removeOrphanedJobs();
      expect(removed).toBe(orphanedIds.length);

      for (const id of orphanedIds) {
        expect(await client.exists(`${baseKey}:${id}`)).toBe(0);
      }
    });

    it('should remove all sub-keys of orphaned jobs', async () => {
      const client = await getRedisClient(queue);
      const baseKey = `${prefix}:${queue.name}`;

      // Create orphaned job with every possible sub-key
      const orphanId = '7777';
      await client.hset(
        `${baseKey}:${orphanId}`,
        'name',
        'orphan',
        'data',
        '{}',
      );
      await client.set(`${baseKey}:${orphanId}:logs`, 'log data');
      await client.set(`${baseKey}:${orphanId}:dependencies`, 'dep data');
      await client.set(`${baseKey}:${orphanId}:processed`, 'proc data');
      await client.set(`${baseKey}:${orphanId}:failed`, 'fail data');
      await client.set(`${baseKey}:${orphanId}:unsuccessful`, 'unsucc data');
      await client.set(`${baseKey}:${orphanId}:lock`, 'lock data');

      const removed = await queue.removeOrphanedJobs();
      expect(removed).toBe(1);

      // Verify all sub-keys deleted
      for (const suffix of [
        '',
        ':logs',
        ':dependencies',
        ':processed',
        ':failed',
        ':unsuccessful',
        ':lock',
      ]) {
        expect(await client.exists(`${baseKey}:${orphanId}${suffix}`)).toBe(0);
      }
    });

    it('should distinguish orphaned jobs from legitimate jobs across all states', async () => {
      const client = await getRedisClient(queue);
      const baseKey = `${prefix}:${queue.name}`;

      // Add jobs in wait state
      const waitJob = await queue.add('wait-job', { state: 'wait' });

      // Add a delayed job
      const delayedJob = await queue.add(
        'delayed-job',
        { state: 'delayed' },
        { delay: 60000 },
      );

      // Add a prioritized job
      const prioritizedJob = await queue.add(
        'prioritized-job',
        { state: 'prioritized' },
        { priority: 3 },
      );

      // Create orphaned jobs
      const orphanedIds = ['8001', '8002', '8003'];
      for (const id of orphanedIds) {
        await client.hset(`${baseKey}:${id}`, { name: 'orphan', data: '{}' });
      }

      const removed = await queue.removeOrphanedJobs();
      expect(removed).toBe(orphanedIds.length);

      // Verify legitimate jobs survived
      expect(await queue.getJob(waitJob.id!)).not.toBeUndefined();
      expect(await queue.getJob(delayedJob.id!)).not.toBeUndefined();
      expect(await queue.getJob(prioritizedJob.id!)).not.toBeUndefined();

      // Verify orphans removed
      for (const id of orphanedIds) {
        expect(await client.exists(`${baseKey}:${id}`)).toBe(0);
      }
    });

    it('should not remove infrastructure keys', async () => {
      const client = await getRedisClient(queue);
      const baseKey = `${prefix}:${queue.name}`;

      // Add a job so infrastructure keys exist
      await queue.add('test', { data: 1 });

      // Verify meta key exists (created on queue init)
      expect(await client.exists(`${baseKey}:meta`)).toBe(1);

      const removed = await queue.removeOrphanedJobs();
      expect(removed).toBe(0);

      // Infrastructure keys should still exist
      expect(await client.exists(`${baseKey}:meta`)).toBe(1);
    });

    it('should not confuse repeat sub-keys with orphaned jobs', async () => {
      const client = await getRedisClient(queue);
      const baseKey = `${prefix}:${queue.name}`;

      // Simulate repeat sub-keys (e.g., repeat:abc123)
      await client.set(`${baseKey}:repeat:some-repeat-id`, 'repeat data');
      // Simulate deduplication sub-keys (e.g., de:some-dedup-id)
      await client.set(`${baseKey}:de:some-dedup-id`, 'dedup data');

      const removed = await queue.removeOrphanedJobs();
      expect(removed).toBe(0);

      // Verify repeat and dedup keys are untouched
      expect(await client.exists(`${baseKey}:repeat:some-repeat-id`)).toBe(1);
      expect(await client.exists(`${baseKey}:de:some-dedup-id`)).toBe(1);

      // Cleanup
      await client.del(
        `${baseKey}:repeat:some-repeat-id`,
        `${baseKey}:de:some-dedup-id`,
      );
    });

    it('should handle jobs with custom string IDs', async () => {
      const client = await getRedisClient(queue);
      const baseKey = `${prefix}:${queue.name}`;

      // Add a real job with a custom ID
      const realJob = await queue.add(
        'test',
        { data: 1 },
        { jobId: 'my-custom-job' },
      );

      // Create an orphan with a custom-looking ID
      const orphanId = 'orphan-custom-id';
      await client.hset(`${baseKey}:${orphanId}`, {
        name: 'orphan',
        data: '{}',
      });

      const removed = await queue.removeOrphanedJobs();
      expect(removed).toBe(1);

      // Real job still exists
      expect(await queue.getJob(realJob.id!)).not.toBeUndefined();
      // Orphan removed
      expect(await client.exists(`${baseKey}:${orphanId}`)).toBe(0);
    });

    it('should detect orphans found only via sub-keys', async () => {
      const client = await getRedisClient(queue);
      const baseKey = `${prefix}:${queue.name}`;

      // Create orphaned sub-keys without a main hash
      // (possible if the hash was partially cleaned)
      const orphanId = '5555';
      await client.set(`${baseKey}:${orphanId}:logs`, 'orphan log');
      await client.set(`${baseKey}:${orphanId}:lock`, 'orphan lock');

      const removed = await queue.removeOrphanedJobs();
      expect(removed).toBe(1);

      expect(await client.exists(`${baseKey}:${orphanId}:logs`)).toBe(0);
      expect(await client.exists(`${baseKey}:${orphanId}:lock`)).toBe(0);
    });

    it('should handle a large number of orphaned jobs across SCAN iterations', async () => {
      const client = await getRedisClient(queue);
      const baseKey = `${prefix}:${queue.name}`;

      // Create enough orphans to require multiple SCAN iterations
      const orphanCount = 150;
      const orphanedIds: string[] = [];
      const pipeline = client.pipeline();
      for (let i = 0; i < orphanCount; i++) {
        const id = `orphan-${String(i).padStart(4, '0')}`;
        orphanedIds.push(id);
        pipeline.hset(`${baseKey}:${id}`, { name: 'orphan', data: '{}' });
      }
      await pipeline.exec();

      // Also add a few real jobs to interleave
      await queue.add('real1', { data: 1 });
      await queue.add('real2', { data: 2 });

      // Use a small scan count to force multiple iterations
      const removed = await queue.removeOrphanedJobs(10);
      expect(removed).toBe(orphanCount);

      // Verify all orphans are gone
      for (const id of orphanedIds) {
        expect(await client.exists(`${baseKey}:${id}`)).toBe(0);
      }

      // Real jobs still exist
      const realJobs = await queue.getJobCountByTypes('wait');
      expect(realJobs).toBe(2);
    });
  });

  // Relocated from clean.test.ts: manipulates the raw Redis job hash
  // (`client.hdel` of the `timestamp` field). This missing-field edge case is
  // Redis-storage-specific — other backends store the timestamp as a
  // non-nullable column, so a job can never lack one.
  it('should clean a job without a timestamp', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('It failed');
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const client = await getRedisClient(queue);

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
});
