import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  createPostgresBackend,
  Queue,
  QueueEvents,
  setDefaultBackendFactory,
  Worker,
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
  // PostgreSQL escapes non-ASCII bytes of `application_name`.
  it('discovers workers and QueueEvents of a non-ASCII queue', async () => {
    const { rows } = await pool.query(
      `SELECT current_setting('server_version_num')::int AS num`,
    );
    const queueName = `café-${randomUUID().slice(0, 8)}`;
    const opts = { autorun: false, connection: {} };
    const queue = new Queue(queueName, { connection: {} });
    const unnamed = new Worker(queueName, async () => {}, opts);
    const named = new Worker(queueName, async () => {}, {
      ...opts,
      name: 'wörker',
    });
    const queueEvents = new QueueEvents(queueName, { connection: {} });

    try {
      await Promise.all(
        [unnamed, named, queueEvents].map(c => c.waitUntilReady()),
      );

      // On 13-15 the `?` replacements past the queue name cannot be undone.
      const namedRaw = `${queueName}:w:${rows[0].num >= 160000 ? 'wörker' : 'w??rker'}`;
      const workers = await queue.getWorkers();
      expect(workers.map(w => w.rawname).sort()).toEqual(
        [queueName, namedRaw].sort(),
      );
      const listed = await queue.getQueueEvents();
      expect(listed.map(c => c.rawname)).toEqual([`${queueName}:qe`]);
    } finally {
      await Promise.all([unnamed, named, queueEvents].map(c => c.close()));
      await queue.close();
    }
  });
});
