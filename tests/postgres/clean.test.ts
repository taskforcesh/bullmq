import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  it('preserves a locked active job so its worker can finish it', async () => {
    const queueName = `clean-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    await queue.waitUntilReady();
    const worker = new Worker(queueName, undefined, {
      connection,
      autorun: false,
    });
    const token = randomUUID();
    try {
      await queue.add('payment', { orderId: 42 });
      const job = await worker.getNextJob(token);
      expect(job).toBeDefined();
      expect(await queue.clean(0, 100, 'active')).toEqual([]);
      expect(await job!.getState()).toBe('active');
      await job!.moveToCompleted('paid', token, false);
      expect(await job!.getState()).toBe('completed');
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
