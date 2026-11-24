import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { Pool } from 'pg';
import {
  createPostgresBackend,
  Job,
  Queue,
  QueueEvents,
  setDefaultBackendFactory,
  SignalTimeoutError,
  Worker,
} from '../src';
import { delay, randomUUID } from '../src/utils';
import { getPostgresUrl } from './postgres/utils/postgres-url';

/**
 * Job signals (Queue.signal / Job.waitForSignal). Backend-agnostic: runs on
 * Redis with the usual configs, and on PostgreSQL when `BULLMQ_TEST_BACKEND`
 * is `postgres` (see vitest.postgres.config.ts).
 */
const usePostgres = process.env.BULLMQ_TEST_BACKEND === 'postgres';

describe('Job signals', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  const schema = 'bullmq_signals_test';
  let pool: Pool | undefined;
  let connection: any;

  let queue: Queue;
  let queueName: string;
  const closables: { close(): Promise<void> }[] = [];

  beforeAll(async () => {
    if (usePostgres) {
      const url = getPostgresUrl();
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
      connection = {};
    } else {
      const { createTestConnection } =
        await import('./utils/connection-factory');
      connection = createTestConnection();
    }
  });

  afterAll(async () => {
    if (usePostgres) {
      setDefaultBackendFactory();
      await pool!.end();
    } else {
      await connection.quit();
    }
  });

  beforeEach(async () => {
    queueName = `test-signals-${randomUUID()}`;
    queue = new Queue(queueName, { connection, prefix });
    await queue.waitUntilReady();
  });

  afterEach(async () => {
    await Promise.all(closables.splice(0).map(c => c.close()));
    await queue.obliterate({ force: true });
    await queue.close();
  });

  const newWorker = (
    processor: (job: Job, token?: string) => Promise<any>,
  ): Worker => {
    const worker = new Worker(queueName, processor, {
      connection,
      prefix,
      drainDelay: 1,
    });
    closables.push(worker);
    return worker;
  };

  const waitFor = async (check: () => Promise<boolean>, timeout = 5000) => {
    const start = Date.now();
    while (!(await check())) {
      if (Date.now() - start > timeout) {
        throw new Error('condition not met in time');
      }
      await delay(20);
    }
  };

  it('moves the job to delayed and wakes it when the signal arrives', async () => {
    let runs = 0;
    const worker = newWorker(async (job, token) => {
      runs++;
      const approval = await job.waitForSignal<{ by: string }>(
        'approval',
        token!,
        { timeout: 60_000 },
      );
      return approval.by;
    });

    const completed = new Promise<{ job: Job; result: string }>(
      (resolve, reject) => {
        worker.on('completed', (job, result) => resolve({ job, result }));
        worker.on('failed', (_job, err) => reject(err));
      },
    );

    const job = await queue.add('report', {});
    await waitFor(async () => (await queue.getJobState(job.id!)) === 'delayed');

    const result = await queue.signal(job.id!, 'approval', { by: 'ana' });
    expect(result).toBe('woken');

    const done = await completed;
    expect(done.result).toBe('ana');
    expect(runs).toBe(2);
    // Waiting for the signal did not use up an attempt: only the run that
    // completed is counted.
    expect(done.job.attemptsMade).toBe(1);
  });

  it('returns a signal sent before the job waits for it', async () => {
    const job = await queue.add('report', {});
    expect(await queue.signal(job.id!, 'approval', 42)).toBe('stored');

    let runs = 0;
    const worker = newWorker(async (job, token) => {
      runs++;
      return job.waitForSignal('approval', token!, { timeout: 60_000 });
    });

    const result = await new Promise((resolve, reject) => {
      worker.on('completed', (_job, result) => resolve(result));
      worker.on('failed', (_job, err) => reject(err));
    });
    expect(result).toBe(42);
    expect(runs).toBe(1);
  });

  it('stores a signal sent while the job is active and returns it on the wait', async () => {
    let release: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    let runs = 0;

    const worker = newWorker(async (job, token) => {
      runs++;
      await gate;
      return job.waitForSignal('approval', token!, { timeout: 60_000 });
    });
    const completed = new Promise((resolve, reject) => {
      worker.on('completed', (_job, result) => resolve(result));
      worker.on('failed', (_job, err) => reject(err));
    });

    const job = await queue.add('report', {});
    await waitFor(async () => (await queue.getJobState(job.id!)) === 'active');

    expect(await queue.signal(job.id!, 'approval', 'yes')).toBe('stored');
    release!();

    expect(await completed).toBe('yes');
    expect(runs).toBe(1);
  });

  it('keeps the latest signal with the same name', async () => {
    const job = await queue.add('report', {});
    await queue.signal(job.id!, 'approval', 'first');
    await queue.signal(job.id!, 'approval', 'second');

    const worker = newWorker(async (job, token) =>
      job.waitForSignal('approval', token!, { timeout: 60_000 }),
    );
    const result = await new Promise((resolve, reject) => {
      worker.on('completed', (_job, result) => resolve(result));
      worker.on('failed', (_job, err) => reject(err));
    });
    expect(result).toBe('second');
  });

  it('does not wake a job that waits for another signal', async () => {
    newWorker(async (job, token) =>
      job.waitForSignal('approval', token!, { timeout: 60_000 }),
    );

    const job = await queue.add('report', {});
    await waitFor(async () => (await queue.getJobState(job.id!)) === 'delayed');

    expect(await queue.signal(job.id!, 'other', true)).toBe('stored');
    await delay(200);
    expect(await queue.getJobState(job.id!)).toBe('delayed');
  });

  it('does not promote a job that is delayed for another reason', async () => {
    const job = await queue.add('report', {}, { delay: 60_000 });

    expect(await queue.signal(job.id!, 'approval', true)).toBe('stored');
    expect(await queue.getJobState(job.id!)).toBe('delayed');
  });

  it('throws SignalTimeoutError when the wait times out', async () => {
    let runs = 0;
    const worker = newWorker(async (job, token) => {
      runs++;
      try {
        await job.waitForSignal('approval', token!, { timeout: 300 });
        return 'approved';
      } catch (err) {
        if (err instanceof SignalTimeoutError) {
          return `timeout:${err.signalName}`;
        }
        throw err;
      }
    });

    await queue.add('report', {});

    const result = await new Promise((resolve, reject) => {
      worker.on('completed', (_job, result) => resolve(result));
      worker.on('failed', (_job, err) => reject(err));
    });
    expect(result).toBe('timeout:approval');
    expect(runs).toBe(2);
  });

  it('keeps the deadline when the job is promoted before the signal arrives', async () => {
    let runs = 0;
    const worker = newWorker(async (job, token) => {
      runs++;
      try {
        await job.waitForSignal('approval', token!, { timeout: 1000 });
        return 'approved';
      } catch (err) {
        if (err instanceof SignalTimeoutError) {
          return 'timeout';
        }
        throw err;
      }
    });
    const completed = new Promise<number>((resolve, reject) => {
      worker.on('completed', (_job, result) =>
        resolve(result === 'timeout' ? Date.now() : -1),
      );
      worker.on('failed', (_job, err) => reject(err));
    });

    const start = Date.now();
    const job = await queue.add('report', {});
    await waitFor(async () => (await queue.getJobState(job.id!)) === 'delayed');

    // Promoting the job runs it again early; it must go back to sleep until
    // the original deadline instead of starting a new 1s wait.
    await (await queue.getJob(job.id!))!.promote();
    await waitFor(async () => runs >= 2);

    const finishedAt = await completed;
    expect(finishedAt - start).toBeGreaterThanOrEqual(900);
    expect(finishedAt - start).toBeLessThan(1900);
    expect(runs).toBe(3);
  });

  it('returns the same signal when the job runs again after a failure', async () => {
    let runs = 0;
    const worker = newWorker(async (job, token) => {
      runs++;
      const value = await job.waitForSignal('approval', token!, {
        timeout: 60_000,
      });
      if (runs === 1) {
        throw new Error('transient');
      }
      return value;
    });
    const completed = new Promise((resolve, reject) => {
      worker.on('completed', (_job, result) => resolve(result));
      worker.on('error', reject);
    });

    const job = await queue.add('report', {}, { attempts: 2 });
    await queue.signal(job.id!, 'approval', 'ok');

    expect(await completed).toBe('ok');
    expect(runs).toBe(2);
  });

  it('rejects signals for missing and finished jobs', async () => {
    await expect(queue.signal('nope', 'approval', 1)).rejects.toThrow(
      /Missing key for job nope/,
    );

    const worker = newWorker(async () => 'done');
    const completed = new Promise(resolve => worker.on('completed', resolve));
    const job = await queue.add('report', {});
    await completed;

    await expect(queue.signal(job.id!, 'approval', 1)).rejects.toThrow(
      /already finished/,
    );
  });

  it('rejects a wait with a wrong token', async () => {
    const job = await queue.add('report', {});
    const worker = newWorker(async () => {
      await delay(10_000);
    });
    await waitFor(async () => (await queue.getJobState(job.id!)) === 'active');

    const active = (await queue.getJob(job.id!))!;
    await expect(
      active.waitForSignal('approval', 'wrong-token', { timeout: 1000 }),
    ).rejects.toThrow(/Lock mismatch/);
    expect(await queue.getJobState(job.id!)).toBe('active');
    await worker.close(true);
  });

  it('emits a signaled event', async () => {
    const queueEvents = new QueueEvents(queueName, { connection, prefix });
    closables.push(queueEvents);
    await queueEvents.waitUntilReady();

    const signaled = new Promise<{ jobId: string; name: string }>(resolve =>
      queueEvents.on('signaled', args => resolve(args)),
    );

    const job = await queue.add('report', {});
    await queue.signal(job.id!, 'approval', true);

    expect(await signaled).toEqual(
      expect.objectContaining({ jobId: job.id, name: 'approval' }),
    );
  });

  it('removes the signals with the job', async () => {
    const job = await queue.add('report', {});
    await queue.signal(job.id!, 'approval', true);
    await job.remove();

    await expect(queue.signal(job.id!, 'approval', true)).rejects.toThrow(
      /Missing key/,
    );
    if (usePostgres) {
      const { rows } = await pool!.query(
        `SELECT count(*)::int AS n FROM "${schema}".job_signal WHERE queue = $1`,
        [queueName],
      );
      expect(rows[0].n).toBe(0);
    } else {
      const { getRedisClient } = await import('./utils/get-redis-client');
      const client = await getRedisClient(queue as any);
      expect(
        await client.exists(`${prefix}:${queueName}:${job.id}:signals`),
      ).toBe(0);
    }
  });
});
