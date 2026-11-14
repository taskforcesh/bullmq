import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPostgresBackend, withBackend } from '../../src';
import { getPostgresUrl } from './utils/postgres-url';

describe('PostgreSQL job scheduler count seeding', () => {
  const url = getPostgresUrl();
  // Dedicated schema so this file is isolated from the other suites.
  const schema = 'bullmq_scheduler_count_test';
  const connection = { connectionString: url, schema, migrate: true };
  const { Queue } = withBackend(createPostgresBackend);
  let pool: Pool;

  const withQueue = async (
    fn: (queue: InstanceType<typeof Queue>) => Promise<void>,
  ) => {
    const queue = new Queue(`count-${randomUUID()}`, { connection });
    try {
      await queue.waitUntilReady();
      await fn(queue);
    } finally {
      await queue.close();
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should seed the iteration count when count is provided', async () => {
    await withQueue(async queue => {
      await queue.upsertJobScheduler(
        'scheduler',
        { every: 1000, count: 100 },
        { name: 'test', data: {} },
      );
      const scheduler = await queue.getJobScheduler('scheduler');
      expect(scheduler?.iterationCount).toBe(101);
    });
  });

  it('should seed the iteration count after removing the scheduler', async () => {
    await withQueue(async queue => {
      await queue.upsertJobScheduler(
        'scheduler',
        { every: 1000, count: 100 },
        { name: 'test', data: {} },
      );
      await queue.removeJobScheduler('scheduler');
      await queue.upsertJobScheduler(
        'scheduler',
        { every: 1000, count: 300 },
        { name: 'test', data: {} },
      );
      const scheduler = await queue.getJobScheduler('scheduler');
      expect(scheduler?.iterationCount).toBe(301);
    });
  });

  it('should not reset the iteration count when re-upserting', async () => {
    await withQueue(async queue => {
      const opts = { every: 1000, count: 100 };
      await queue.upsertJobScheduler('scheduler', opts, {
        name: 'test',
        data: {},
      });
      await queue.upsertJobScheduler('scheduler', opts, {
        name: 'test',
        data: {},
      });
      const scheduler = await queue.getJobScheduler('scheduler');
      expect(scheduler?.iterationCount).toBe(101);
    });
  });
});
