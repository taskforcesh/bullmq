import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresBackend, withBackend } from '../../src';
import { getPostgresUrl } from './utils/postgres-url';

describe('PostgreSQL cleaner', () => {
  const connectionString = getPostgresUrl();
  const schema = 'bullmq_clean_test';
  const { Queue, Worker } = withBackend(createPostgresBackend);
  const connection = { connectionString, schema, migrate: true };
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it.each([0, -60_000, 60_000])(
    'preserves a live lock with client clock offset %i',
    async clockOffset => {
      const queueName = `clean-${randomUUID()}`;
      const queue = new Queue(queueName, { connection });
      await queue.waitUntilReady();
      const worker = new Worker(queueName, undefined, {
        connection,
        autorun: false,
      });
      const token = randomUUID();
      const originalNow = Date.now;
      let elapsed = 0;
      const clock = vi
        .spyOn(Date, 'now')
        .mockImplementation(() => originalNow() + clockOffset + elapsed);
      try {
        await queue.add('payment', { orderId: 42 });
        const job = await worker.getNextJob(token);
        expect(job).toBeDefined();
        expect(await queue.clean(0, 100, 'active')).toEqual([]);
        expect(await job!.getState()).toBe('active');
        elapsed = 20_000;
        await job!.extendLock(token, 30_000);
        elapsed = 40_000;
        expect(await queue.clean(0, 100, 'active')).toEqual([]);
        expect(await queue.clean(-60_000, 100, 'active')).toEqual([]);
        await job!.moveToCompleted('paid', token, false);
        expect(await job!.getState()).toBe('completed');
      } finally {
        clock.mockRestore();
        await worker.close();
        await queue.close();
      }
    },
  );

  it('cleans an active job fetched without a processing lock', async () => {
    const queueName = `clean-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    await queue.waitUntilReady();
    const worker = new Worker(queueName, undefined, {
      connection,
      autorun: false,
    });
    try {
      await queue.add('unlocked', {});
      const job = await worker.getNextJob('0');
      expect(await queue.clean(0, 100, 'active')).toEqual([job!.id]);
      expect(await queue.getJob(job!.id!)).toBeUndefined();
    } finally {
      await worker.close();
      await queue.close();
    }
  });

  it('cleans an expired lock when the client clock is ahead of the database', async () => {
    const queueName = `clean-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    await queue.waitUntilReady();
    const worker = new Worker(queueName, undefined, {
      connection,
      autorun: false,
    });
    const originalNow = Date.now;
    const clock = vi
      .spyOn(Date, 'now')
      .mockImplementation(() => originalNow() + 60_000);
    try {
      await queue.add('expired', {});
      const job = await worker.getNextJob(randomUUID());
      clock.mockImplementation(() => originalNow() + 180_000);
      expect(await queue.clean(60_000, 100, 'active')).toEqual([job!.id]);
    } finally {
      clock.mockRestore();
      await worker.close();
      await queue.close();
    }
  });

  it('does not apply the grace period a second time to lock expiry', async () => {
    const queueName = `clean-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    await queue.waitUntilReady();
    const worker = new Worker(queueName, undefined, {
      connection,
      autorun: false,
    });
    try {
      await queue.add('expired', {});
      const job = await worker.getNextJob(randomUUID());
      const now = Date.now();
      await pool.query(
        `UPDATE "${schema}".job SET processed_at_ms = $3, locked_until_ms = $4
         WHERE queue = $1 AND id = $2`,
        [queueName, job!.id, now - 120_000, now - 1],
      );
      expect(await queue.clean(60_000, 100, 'active')).toEqual([job!.id]);
    } finally {
      await worker.close();
      await queue.close();
    }
  });

  it.each(['expired', 'missing'])(
    'cleans an active job whose lock is %s',
    async lock => {
      const queueName = `clean-${randomUUID()}`;
      const queue = new Queue(queueName, { connection });
      await queue.waitUntilReady();
      const worker = new Worker(queueName, undefined, {
        connection,
        autorun: false,
      });
      try {
        await queue.add('abandoned', {});
        const job = await worker.getNextJob(randomUUID());
        await pool.query(
          `UPDATE "${schema}".job SET lock_token = $3, locked_until_ms = $4
         WHERE queue = $1 AND id = $2`,
          [
            queueName,
            job!.id,
            lock === 'missing' ? null : 'expired',
            lock === 'missing' ? null : Date.now() - 1,
          ],
        );
        expect(await queue.clean(0, 100, 'active')).toEqual([job!.id]);
        expect(await queue.getJob(job!.id!)).toBeUndefined();
      } finally {
        await worker.close();
        await queue.close();
      }
    },
  );

  it.each([
    { token: 'live', remaining: 30_000, removed: false },
    { token: 'expired', remaining: -1, removed: false },
    { token: '0', remaining: 30_000, removed: true },
    { token: null, remaining: null, removed: true },
  ])(
    'supports legacy cleanup with token $token',
    async ({ token, remaining, removed }) => {
      const queueName = `clean-${randomUUID()}`;
      const queue = new Queue(queueName, { connection });
      await queue.waitUntilReady();
      const worker = new Worker(queueName, undefined, {
        connection,
        autorun: false,
      });
      try {
        await queue.add('legacy', {});
        const job = await worker.getNextJob(randomUUID());
        const now = Date.now();
        await pool.query(
          `UPDATE "${schema}".job SET lock_token = $3, locked_until_ms = $4
         WHERE queue = $1 AND id = $2`,
          [
            queueName,
            job!.id,
            token,
            remaining === null ? null : now + remaining,
          ],
        );
        const { rows } = await pool.query(
          `SELECT id FROM "${schema}".clean($1, $2, $3, $4) AS t(id)`,
          [queueName, 'active', now + 60_000, 100],
        );
        expect(rows.map(row => row.id)).toEqual(removed ? [job!.id] : []);
        expect(await job!.getState()).toBe(removed ? 'unknown' : 'active');
      } finally {
        await worker.close();
        await queue.close();
      }
    },
  );

  it('uses the last processing time for the active grace period', async () => {
    const queueName = `clean-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    await queue.waitUntilReady();
    const worker = new Worker(queueName, undefined, {
      connection,
      autorun: false,
    });
    try {
      await queue.add(
        'recently-started',
        {},
        { timestamp: Date.now() - 120_000 },
      );
      const job = await worker.getNextJob('0');
      await pool.query(
        `UPDATE "${schema}".job SET lock_token = NULL, locked_until_ms = NULL
         WHERE queue = $1 AND id = $2`,
        [queueName, job!.id],
      );
      expect(await queue.clean(60_000, 100, 'active')).toEqual([]);
      expect(await job!.getState()).toBe('active');
    } finally {
      await worker.close();
      await queue.close();
    }
  });

  it('applies the limit after excluding live locks', async () => {
    const queueName = `clean-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    await queue.waitUntilReady();
    const worker = new Worker(queueName, undefined, {
      connection,
      autorun: false,
    });
    try {
      await queue.addBulk([
        { name: 'running', data: {} },
        { name: 'abandoned', data: {} },
        { name: 'waiting', data: {} },
      ]);
      const token = randomUUID();
      const running = await worker.getNextJob(token);
      const abandoned = await worker.getNextJob(randomUUID());
      await pool.query(
        `UPDATE "${schema}".job SET locked_until_ms = $3
         WHERE queue = $1 AND id = $2`,
        [queueName, abandoned!.id, Date.now() - 1],
      );
      expect(await queue.clean(0, 1, 'active')).toEqual([abandoned!.id]);
      expect(await queue.getJobCounts('active', 'waiting')).toMatchObject({
        active: 1,
        waiting: 1,
      });
      await running!.moveToCompleted('done', token, false);
    } finally {
      await worker.close();
      await queue.close();
    }
  });
});
