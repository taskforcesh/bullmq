import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  createPostgresBackend,
  Queue,
  setDefaultBackendFactory,
} from '../../src';
import { getPostgresUrl } from './utils/postgres-url';

/**
 * Queue-level getters against PostgreSQL. Pausing a queue only sets metadata;
 * the jobs stay in the `waiting` state, so they must keep being counted as
 * waiting, as on Redis.
 */
describe('PostgreSQL queue getters', () => {
  const url = getPostgresUrl();
  const schema = 'bullmq_getters_test';
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    setDefaultBackendFactory((name, opts, options) =>
      createPostgresBackend(
        name,
        {
          ...opts,
          connection: { connectionString: url, schema, migrate: true },
        },
        options,
      ),
    );
  });

  afterAll(async () => {
    setDefaultBackendFactory(); // reset to the Redis default
    await pool.end();
  });

  it('counts waiting jobs while the queue is paused', async () => {
    const queue = new Queue(`paused-count-${randomUUID()}`, {
      connection: {},
    });

    try {
      await queue.add('a', {});
      await queue.add('b', {});
      await queue.pause();

      expect(await queue.getWaitingCount()).toBe(2);
      expect(await queue.count()).toBe(2);
      expect(await queue.getJobCounts('waiting', 'wait')).toEqual({
        waiting: 2,
        wait: 2,
      });
    } finally {
      await queue.close();
    }
  });

  // Same pages as on Redis: ascending pages start at the oldest job and
  // descending pages at the newest, each in the requested order.
  it('pages waiting jobs in both directions', async () => {
    const queue = new Queue(`pages-${randomUUID()}`, { connection: {} });

    try {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push((await queue.add('page', {})).id!);
      }
      const newest = [...ids].reverse();
      const page = async (start: number, end: number, asc: boolean) =>
        (await queue.getJobs(['wait'], start, end, asc)).map(job => job.id);

      expect(await page(0, 1, true)).toEqual(ids.slice(0, 2));
      expect(await page(1, 3, true)).toEqual(ids.slice(1, 4));
      expect(await page(0, -1, true)).toEqual(ids);
      expect(await page(0, 1, false)).toEqual(newest.slice(0, 2));
      expect(await page(1, 3, false)).toEqual(newest.slice(1, 4));
      expect(await page(0, -1, false)).toEqual(newest);
    } finally {
      await queue.close();
    }
  });
});
