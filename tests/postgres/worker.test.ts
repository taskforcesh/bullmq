import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
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
 * End-to-end: a real {@link Queue} and {@link Worker} backed by PostgreSQL,
 * exercising the full add → LISTEN/NOTIFY wakeup → moveToActive → process →
 * moveToCompleted loop against a live server.
 */
describe('PostgreSQL Worker (end-to-end)', () => {
  const url = getPostgresUrl();
  const schema = 'bullmq_worker_test';
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    // Point every Queue/Worker built in this file at PostgreSQL.
    setDefaultBackendFactory((name, opts, options) =>
      createPostgresBackend(
        name,
        { ...opts, connection: { connectionString: url, schema } },
        options,
      ),
    );
  });

  afterAll(async () => {
    setDefaultBackendFactory(); // reset to the Redis default
    await pool.end();
  });

  it('processes a job added to the queue', async () => {
    const qname = `wq-${randomUUID()}`;
    const queue = new Queue(qname, { connection: {} });
    const worker = new Worker<{ x: number }, number>(
      qname,
      async job => job.data.x * 2,
      { connection: {}, drainDelay: 1 },
    );

    const completed = new Promise<{ id: string; result: number }>(
      (resolve, reject) => {
        worker.on('completed', (job, result) =>
          resolve({ id: job.id!, result }),
        );
        worker.on('failed', (_job, err) => reject(err));
        worker.on('error', reject);
      },
    );

    await worker.waitUntilReady();
    const added = await queue.add('double', { x: 21 });

    const { id, result } = await completed;
    expect(id).toBe(added.id);
    expect(result).toBe(42);

    // The job is now persisted as completed with its return value.
    const state = await queue.getJobState(added.id!);
    expect(state).toBe('completed');

    await worker.close();
    await queue.close();
  });

  it('processes several jobs in FIFO order', async () => {
    const qname = `wq-${randomUUID()}`;
    const queue = new Queue(qname, { connection: {} });
    const processed: number[] = [];
    const worker = new Worker<{ n: number }>(
      qname,
      async job => {
        processed.push(job.data.n);
      },
      { connection: {}, drainDelay: 1 },
    );

    await worker.waitUntilReady();
    await queue.addBulk([
      { name: 'j', data: { n: 1 } },
      { name: 'j', data: { n: 2 } },
      { name: 'j', data: { n: 3 } },
    ]);

    await new Promise<void>((resolve, reject) => {
      worker.on('completed', () => {
        if (processed.length === 3) {
          resolve();
        }
      });
      worker.on('failed', (_job, err) => reject(err));
      worker.on('error', reject);
    });

    expect(processed).toEqual([1, 2, 3]);

    await worker.close();
    await queue.close();
  });

  it('retries with backoff delay then succeeds', async () => {
    const qname = `wq-${randomUUID()}`;
    const queue = new Queue(qname, { connection: {} });
    let attempts = 0;
    const worker = new Worker<{ x: number }, number>(
      qname,
      async job => {
        attempts++;
        if (job.attemptsMade < 1) {
          throw new Error('transient');
        }
        return job.data.x;
      },
      { connection: {}, drainDelay: 1 },
    );

    await worker.waitUntilReady();
    const added = await queue.add(
      'retryable',
      { x: 7 },
      { attempts: 3, backoff: { type: 'fixed', delay: 60 } },
    );

    const result = await new Promise<number>((resolve, reject) => {
      worker.on('completed', (_job, res) => resolve(res));
      worker.on('error', reject);
    });

    expect(result).toBe(7);
    expect(attempts).toBe(2); // failed once, then succeeded
    expect(await queue.getJobState(added.id!)).toBe('completed');

    await worker.close();
    await queue.close();
  });

  it('retries immediately (no backoff) then succeeds', async () => {
    const qname = `wq-${randomUUID()}`;
    const queue = new Queue(qname, { connection: {} });
    let attempts = 0;
    const worker = new Worker<{ x: number }, number>(
      qname,
      async job => {
        attempts++;
        if (job.attemptsMade < 1) {
          throw new Error('transient');
        }
        return job.data.x * 10;
      },
      { connection: {}, drainDelay: 1 },
    );

    await worker.waitUntilReady();
    await queue.add('retryable', { x: 3 }, { attempts: 2 });

    const result = await new Promise<number>((resolve, reject) => {
      worker.on('completed', (_job, res) => resolve(res));
      worker.on('error', reject);
    });

    expect(result).toBe(30);
    expect(attempts).toBe(2);

    await worker.close();
    await queue.close();
  });

  it('fails permanently after exhausting attempts', async () => {
    const qname = `wq-${randomUUID()}`;
    const queue = new Queue(qname, { connection: {} });
    const worker = new Worker(
      qname,
      async () => {
        throw new Error('always fails');
      },
      { connection: {}, drainDelay: 1 },
    );

    await worker.waitUntilReady();
    const added = await queue.add('doomed', {}, { attempts: 1 });

    const err = await new Promise<Error>((resolve, reject) => {
      worker.on('failed', (_job, e) => resolve(e));
      worker.on('error', reject);
    });

    expect(err.message).toBe('always fails');
    expect(await queue.getJobState(added.id!)).toBe('failed');

    const data = await queue.getJob(added.id!);
    expect(data!.failedReason).toBe('always fails');

    await worker.close();
    await queue.close();
  });

  it('supports job.waitUntilFinished via QueueEvents', async () => {
    const qname = `wq-${randomUUID()}`;
    const queue = new Queue(qname, { connection: {} });
    const queueEvents = new QueueEvents(qname, { connection: {} });
    const worker = new Worker<{ x: number }, number>(
      qname,
      async job => {
        await new Promise(r => setTimeout(r, 30));
        return job.data.x + 1;
      },
      { connection: {}, drainDelay: 1 },
    );

    await queueEvents.waitUntilReady();
    await worker.waitUntilReady();

    const job = await queue.add('inc', { x: 41 });
    const result = await job.waitUntilFinished(queueEvents);
    expect(result).toBe(42);

    await worker.close();
    await queueEvents.close();
    await queue.close();
  });

  it('delivers a completed event to QueueEvents listeners', async () => {
    const qname = `wq-${randomUUID()}`;
    const queue = new Queue(qname, { connection: {} });
    const queueEvents = new QueueEvents(qname, { connection: {} });
    const worker = new Worker<{ x: number }, number>(
      qname,
      async job => job.data.x * 3,
      { connection: {}, drainDelay: 1 },
    );

    await queueEvents.waitUntilReady();
    await worker.waitUntilReady();

    const completed = new Promise<{ jobId: string; returnvalue: any }>(
      resolve => {
        queueEvents.on('completed', ({ jobId, returnvalue }) =>
          resolve({ jobId, returnvalue }),
        );
      },
    );

    const job = await queue.add('triple', { x: 5 });
    const ev = await completed;
    expect(ev.jobId).toBe(job.id);
    expect(ev.returnvalue).toBe(15);

    await worker.close();
    await queueEvents.close();
    await queue.close();
  });
});
