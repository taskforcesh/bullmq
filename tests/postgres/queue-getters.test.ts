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
});
