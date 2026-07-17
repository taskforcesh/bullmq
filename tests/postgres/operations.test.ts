import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { createPostgresBackend, IQueueBackend, JobJson } from '../../src';
import { getPostgresUrl } from './utils/postgres-url';

/**
 * Direct backend-level tests for the core FIFO operation slice
 * (add → moveToActive → moveToComplete/Fail) against a live PostgreSQL server.
 * These exercise the backend contract without the full Worker loop.
 */
describe('PostgreSQL backend operations', () => {
  const url = getPostgresUrl();
  // Dedicated schema so this file is isolated from the migration suite even
  // when test files run in parallel.
  const schema = 'bullmq_ops_test';
  let pool: Pool;

  const makeJob = (over: Partial<JobJson> = {}): JobJson =>
    ({
      id: '',
      name: 'test-job',
      data: JSON.stringify({ foo: 'bar' }),
      opts: { attempts: 3 },
      progress: 0,
      attemptsMade: 0,
      attemptsStarted: 0,
      timestamp: Date.now(),
      failedReason: '',
      returnvalue: 'null',
      stalledCounter: 0,
      ...over,
    }) as JobJson;

  const newBackend = (): IQueueBackend =>
    createPostgresBackend(`ops-${randomUUID()}`, {
      connection: { connectionString: url, schema },
    } as any);

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    // Clean slate so migrations re-run from scratch.
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('adds a job (FIFO waiting) and reads it back', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();

      const id = await backend.addJob(makeJob(), '');
      expect(id).toBe('1'); // per-queue numeric id starts at 1

      const data = await backend.getJobData(id);
      expect(data).toBeTruthy();
      expect(data!.name).toBe('test-job');
      expect(JSON.parse(data!.data)).toEqual({ foo: 'bar' });
      expect(data!.opts).toMatchObject({ attempts: 3 });

      expect(await backend.getState(id)).toBe('waiting');
      const [waiting] = await backend.getCounts(['waiting']);
      expect(waiting).toBe(1);
    } finally {
      await backend.close();
    }
  });

  it('claims the next job with moveToActive and completes it', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      const token = randomUUID();

      const id = await backend.addJob(makeJob({ name: 'a' }), '');

      const [jobData, claimedId, rateLimit, delayUntil] =
        await backend.moveToActive(token);
      expect(claimedId).toBe(id);
      expect(jobData).toBeTruthy();
      expect((jobData as JobJson).name).toBe('a');
      expect(rateLimit).toBe(0);
      expect(delayUntil).toBe(0);
      expect(await backend.getState(id)).toBe('active');

      // Lock can be extended while held.
      expect(await backend.extendLock(id, token, 30000)).toBe(1);

      const { finishedOn } = await backend.moveToCompleted(
        { id } as any,
        { result: 42 },
        false,
        token,
        false,
      );
      expect(finishedOn).toBeGreaterThan(0);
      expect(await backend.getState(id)).toBe('completed');

      const data = await backend.getJobData(id);
      expect(JSON.parse(data!.returnvalue)).toEqual({ result: 42 });

      const [, completed] = await backend.getCounts(['active', 'completed']);
      expect(completed).toBe(1);
    } finally {
      await backend.close();
    }
  });

  it('returns no job when the queue is empty', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      const [jobData, id] = await backend.moveToActive(randomUUID());
      expect(jobData).toBeNull();
      expect(id).toBe('');
    } finally {
      await backend.close();
    }
  });

  it('preserves FIFO order across multiple jobs', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      const token = randomUUID();
      const id1 = await backend.addJob(makeJob({ name: 'first' }), '');
      const id2 = await backend.addJob(makeJob({ name: 'second' }), '');

      const [j1] = await backend.moveToActive(token);
      const [j2] = await backend.moveToActive(token);
      expect((j1 as JobJson).id).toBe(id1);
      expect((j2 as JobJson).id).toBe(id2);
    } finally {
      await backend.close();
    }
  });

  it('fails a job and records the reason', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      const token = randomUUID();
      const id = await backend.addJob(makeJob(), '');
      await backend.moveToActive(token);

      const { finishedOn } = await backend.moveToFailed(
        { id } as any,
        'boom',
        false,
        token,
        false,
      );
      expect(finishedOn).toBeGreaterThan(0);
      expect(await backend.getState(id)).toBe('failed');

      const data = await backend.getJobData(id);
      expect(data!.failedReason).toBe('boom');
    } finally {
      await backend.close();
    }
  });

  it('rejects completing a job held by a different token', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      const id = await backend.addJob(makeJob(), '');
      await backend.moveToActive('right-token');

      await expect(
        backend.moveToCompleted({ id } as any, 1, false, 'wrong-token', false),
      ).rejects.toBeTruthy();
    } finally {
      await backend.close();
    }
  });

  it('appends and reads job logs', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      const id = await backend.addJob(makeJob(), '');

      expect(await backend.addLog(id, 'line 1')).toBe(1);
      expect(await backend.addLog(id, 'line 2')).toBe(2);

      const { logs, count } = await backend.getJobLogs(id, 0, -1, true);
      expect(count).toBe(2);
      expect(logs).toEqual(['line 1', 'line 2']);
    } finally {
      await backend.close();
    }
  });

  it('stores and reads queue metadata', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      await backend.setQueueMeta({ concurrency: 5, paused: '0' });

      expect(await backend.getQueueMetaField('concurrency')).toBe('5');
      expect(await backend.hasQueueMetaField('concurrency')).toBe(true);
      expect(
        await backend.getQueueMetaFields(['concurrency', 'missing']),
      ).toEqual(['5', null]);

      await backend.removeQueueMetaFields(['paused']);
      expect(await backend.hasQueueMetaField('paused')).toBe(false);
    } finally {
      await backend.close();
    }
  });

  it('routes a delayed job to the delayed state and promotes it when due', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      const token = randomUUID();
      const id = await backend.addJob(makeJob({ delay: 50 }), '');
      expect(await backend.getState(id)).toBe('delayed');

      // Not due yet.
      const [early] = await backend.moveToActive(token);
      expect(early).toBeNull();

      await new Promise(r => setTimeout(r, 80));

      const [jobData, claimedId] = await backend.moveToActive(token);
      expect(claimedId).toBe(id);
      expect(jobData).toBeTruthy();
    } finally {
      await backend.close();
    }
  });

  it('removeOnComplete: true removes the job on completion', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      const token = randomUUID();
      const id = await backend.addJob(makeJob(), '');
      await backend.moveToActive(token);

      await backend.moveToCompleted({ id } as any, 1, true, token, false);

      expect(await backend.getState(id)).toBe('unknown');
      expect(await backend.getJobData(id)).toBeUndefined();
    } finally {
      await backend.close();
    }
  });

  it('removeOnComplete: N keeps only the N most-recent completed jobs', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      const token = randomUUID();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const id = await backend.addJob(makeJob(), '');
        await backend.moveToActive(token);
        // keep at most 2 completed jobs
        await backend.moveToCompleted({ id } as any, i, 2, token, false);
        ids.push(id);
      }

      // Oldest (ids[0]) should have been pruned; the two most recent remain.
      const [, completed] = await backend.getCounts(['active', 'completed']);
      expect(completed).toBe(2);
      expect(await backend.getJobData(ids[0])).toBeUndefined();
      expect(await backend.getJobData(ids[2])).toBeTruthy();
    } finally {
      await backend.close();
    }
  });

  it('removeOnFail: true removes the job on failure', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      const token = randomUUID();
      const id = await backend.addJob(makeJob(), '');
      await backend.moveToActive(token);

      await backend.moveToFailed({ id } as any, 'boom', true, token, false);

      expect(await backend.getState(id)).toBe('unknown');
    } finally {
      await backend.close();
    }
  });

  it('removeOnComplete: -1 keeps the job (negative keep-count is not a LIMIT)', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      const token = randomUUID();
      const id = await backend.addJob(makeJob(), '');
      await backend.moveToActive(token);

      // A negative keep-count is the "keep everything" sentinel (-1). It must
      // disable count-based trimming rather than produce a negative SQL LIMIT.
      await backend.moveToCompleted({ id } as any, 1, -1, token, false);

      expect(await backend.getState(id)).toBe('completed');
      expect(await backend.getJobData(id)).toBeTruthy();
    } finally {
      await backend.close();
    }
  });
});
