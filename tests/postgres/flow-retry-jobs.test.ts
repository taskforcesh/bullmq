import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPostgresBackend, withBackend } from '../../src';
import { getPostgresUrl } from './utils/postgres-url';

/**
 * PostgreSQL counterpart of the Redis `queue.retryJobs` flow cases in
 * tests/flow.test.ts, plus the #5088 repro: retrying a completed flow child
 * must put that child back on the parent's pending dependencies. On the
 * pre-0012 `retry_jobs` function the child returns to waiting while its
 * dependency stays processed, so the parent is released when another child
 * finishes.
 */
describe('PostgreSQL retryJobs flow dependencies', () => {
  const url = getPostgresUrl();
  const schema = `retry_${randomUUID().replace(/-/g, '')}`;
  const connection = {
    connectionString: url,
    schema,
    migrate: true,
  };
  const { Queue, Worker, FlowProducer } = withBackend(createPostgresBackend);
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    const queue = new Queue(`migrate-${randomUUID()}`, { connection });
    try {
      await queue.waitUntilReady();
    } finally {
      await queue.close();
    }
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  it('keeps the parent in waiting-children when retryJobs reruns one completed child', async () => {
    const name = `flow-retry-${randomUUID()}`;
    const queue = new Queue(name, { connection });
    const flow = new FlowProducer({ connection });
    const worker = new Worker(name, null, { connection, autorun: false });

    try {
      await queue.waitUntilReady();
      await flow.waitUntilReady();
      await worker.waitUntilReady();

      const { job: parent } = await flow.add({
        name: 'parent',
        queueName: name,
        children: [
          { name: 'A', queueName: name },
          { name: 'B', queueName: name },
        ],
      });

      const childA = await worker.getNextJob('t1', { block: false });
      expect(childA?.name).toBe('A');
      await childA!.moveToCompleted('a', 't1', false);

      const completedA = await queue.getJob(childA!.id!);
      expect(completedA?.attemptsMade).toBe(1);
      expect(completedA?.attemptsStarted).toBe(1);

      await queue.retryJobs({ state: 'completed' });

      const retriedA = await queue.getJob(childA!.id!);
      expect(await retriedA!.getState()).toBe('waiting');
      await expect(parent.getDependenciesCount()).resolves.toEqual({
        processed: 0,
        unprocessed: 2,
        ignored: 0,
        failed: 0,
      });
      // Redis moveJobsToWait does not reset attempts. The old function zeroed
      // them, so a retried job looked like it had never run.
      expect(retriedA?.attemptsMade).toBe(1);
      expect(retriedA?.attemptsStarted).toBe(1);

      const childB = await worker.getNextJob('t2', { block: false });
      expect(childB?.name).toBe('B');
      await childB!.moveToCompleted('b', 't2', false);

      expect(await (await queue.getJob(childA!.id!))!.getState()).toBe(
        'waiting',
      );
      expect(await (await queue.getJob(parent.id!))!.getState()).toBe(
        'waiting-children',
      );
      await expect(
        (await queue.getJob(parent.id!))!.getDependenciesCount(),
      ).resolves.toEqual({
        processed: 1,
        unprocessed: 1,
        ignored: 0,
        failed: 0,
      });
    } finally {
      await worker.close();
      await flow.close();
      await queue.close();
    }
  });

  it('moves completed children back to the parent dependencies', async () => {
    const queueName = `children-${randomUUID()}`;
    const parentQueueName = `parent-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    const flow = new FlowProducer({ connection });
    let worker: InstanceType<typeof Worker> | undefined = new Worker(
      queueName,
      async () => {},
      { connection, drainDelay: 1 },
    );
    let completedCount = 0;
    const completing = new Promise<void>(resolve => {
      worker!.on('completed', () => {
        completedCount++;
        if (completedCount === 2) {
          resolve();
        }
      });
    });

    try {
      await queue.waitUntilReady();
      await flow.waitUntilReady();
      await worker.waitUntilReady();

      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          { name: 'child-job', data: { idx: 0 }, queueName },
          { name: 'child-job', data: { idx: 1 }, queueName },
        ],
      });

      await completing;
      await worker.close();
      worker = undefined;

      await queue.retryJobs({ state: 'completed' });

      const { processed, unprocessed } = await tree.job.getDependenciesCount({
        processed: true,
        unprocessed: true,
      });
      expect(processed).toBe(0);
      expect(unprocessed).toBe(2);
      // The parent was already released when the last child finished. Retry
      // re-pends the children and does not move the parent back.
      expect(await tree.job.getState()).toBe('waiting');
    } finally {
      await worker?.close();
      await flow.close();
      await queue.close();
    }
  });

  it('moves a failed ignored child back to the parent dependencies', async () => {
    const queueName = `children-${randomUUID()}`;
    const parentQueueName = `parent-${randomUUID()}`;
    const queue = new Queue(queueName, { connection });
    const flow = new FlowProducer({ connection });
    let worker: InstanceType<typeof Worker> | undefined = new Worker(
      queueName,
      async () => {
        throw new Error('error');
      },
      { connection, drainDelay: 1 },
    );
    const failing = new Promise<void>(resolve => {
      worker!.once('failed', () => resolve());
    });

    try {
      await queue.waitUntilReady();
      await flow.waitUntilReady();
      await worker.waitUntilReady();

      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          {
            name: 'child-job',
            data: { foo: 'bar' },
            queueName,
            opts: { ignoreDependencyOnFailure: true, attempts: 1 },
          },
        ],
      });

      await failing;
      await worker.close();
      worker = undefined;

      const failedChild = await queue.getJob(tree.children![0].job.id!);
      expect(failedChild?.attemptsMade).toBe(1);

      await queue.retryJobs({ state: 'failed' });

      const retried = await queue.getJob(tree.children![0].job.id!);
      expect(await retried!.getState()).toBe('waiting');
      const { ignored, unprocessed } = await tree.job.getDependenciesCount({
        ignored: true,
        unprocessed: true,
      });
      expect(ignored).toBe(0);
      expect(unprocessed).toBe(1);
      expect(retried?.attemptsMade).toBe(1);
      expect(await tree.job.getState()).toBe('waiting');
    } finally {
      await worker?.close();
      await flow.close();
      await queue.close();
    }
  });

  async function withSchema(client: PoolClient): Promise<void> {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query("SET deadlock_timeout TO '200ms'");
    await client.query("SET statement_timeout TO '8s'");
  }

  async function advisoryGranted(
    pid: number,
    queue: string,
    id: string,
  ): Promise<boolean> {
    const { rows } = await pool.query<{ held: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks
          WHERE pid = $1
            AND locktype = 'advisory'
            AND granted
            AND objsubid = 1
            AND ((classid::bigint << 32) | objid::bigint)
                = hashtext('bullmq:parent:' || $2 || ':' || $3)::bigint
       ) AS held`,
      [pid, queue, id],
    );
    return rows[0].held;
  }

  async function advisoryWaitingOn(
    pid: number,
    queue: string,
    id: string,
  ): Promise<boolean> {
    const { rows } = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_locks
          WHERE pid = $1
            AND locktype = 'advisory'
            AND NOT granted
            AND objsubid = 1
            AND ((classid::bigint << 32) | objid::bigint)
                = hashtext('bullmq:parent:' || $2 || ':' || $3)::bigint
       ) AS waiting`,
      [pid, queue, id],
    );
    return rows[0].waiting;
  }

  async function blockingPids(pid: number): Promise<number[]> {
    const { rows } = await pool.query<{ blockers: number[] }>(
      'SELECT pg_blocking_pids($1) AS blockers',
      [pid],
    );
    return (rows[0].blockers ?? []).map(Number);
  }

  it('does not deadlock when retried parents are children on the other queue', async () => {
    const q1 = `cross-a-${randomUUID()}`;
    const q2 = `cross-b-${randomUUID()}`;
    const blocker = await pool.connect();
    const retry1 = await pool.connect();
    const retry2 = await pool.connect();
    let pending1: Promise<{ error?: Error; n?: number }> | undefined;
    let pending2: Promise<{ error?: Error; n?: number }> | undefined;
    try {
      await withSchema(blocker);
      await withSchema(retry1);
      await withSchema(retry2);
      await blocker.query(
        `INSERT INTO job (
           queue, id, seq, name, state, data, opts, added_at_ms,
           finished_at_ms, pending_deps, parent_queue, parent_id
         ) VALUES
           ($1, 'P1', 1, 'p', 'completed', '{}', '{}', 1, 10, 0, NULL, NULL),
           ($2, 'C1', 2, 'c', 'completed', '{}', '{}', 1, 11, 0, $1, 'P1'),
           ($2, 'P2', 3, 'p', 'completed', '{}', '{}', 1, 12, 0, NULL, NULL),
           ($1, 'C2', 4, 'c', 'completed', '{}', '{}', 1, 13, 0, $2, 'P2')`,
        [q1, q2],
      );
      await blocker.query(
        `INSERT INTO job_dependency (
           parent_queue, parent_id, child_queue, child_id, child_key, status
         ) VALUES
           ($1, 'P1', $2, 'C1', $2 || ':C1', 'processed'),
           ($2, 'P2', $1, 'C2', $1 || ':C2', 'processed')`,
        [q1, q2],
      );

      // Both retries lock P1 and P2 (depth 0) after their own children.
      // Hold the later of those two keys so each retry is inside the lock
      // loop, holding the earlier key, before either updates a row.
      const { rows: depth0 } = await blocker.query<{
        queue: string;
        id: string;
      }>(
        `SELECT queue, id
           FROM (VALUES ($1::text, 'P1'), ($2::text, 'P2')) AS t(queue, id)
          ORDER BY hashtext('bullmq:parent:' || queue || ':' || id), queue, id`,
        [q1, q2],
      );
      const earlier = depth0[0];
      const later = depth0[1];

      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT pg_advisory_xact_lock(hashtext('bullmq:parent:' || $1 || ':' || $2))`,
        [later.queue, later.id],
      );
      const blockerPid = (
        await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0].pid;
      const retry1Pid = (
        await retry1.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0].pid;
      const retry2Pid = (
        await retry2.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0].pid;

      const track = (query: Promise<{ rows: { n: number }[] }>) => {
        let settled: { error?: Error; n?: number } | undefined;
        const pending = query.then(
          result => {
            settled = { n: Number(result.rows[0].n) };
            return settled;
          },
          (error: Error) => {
            settled = { error };
            return settled;
          },
        );
        return { pending, read: () => settled };
      };
      const first = track(
        retry1.query(`SELECT retry_jobs($1, 'completed', NULL, NULL) AS n`, [
          q1,
        ]),
      );
      const second = track(
        retry2.query(`SELECT retry_jobs($1, 'completed', NULL, NULL) AS n`, [
          q2,
        ]),
      );
      pending1 = first.pending;
      pending2 = second.pending;

      await vi.waitFor(async () => {
        const settled1 = first.read();
        const settled2 = second.read();
        if (settled1?.error) {
          throw settled1.error;
        }
        if (settled2?.error) {
          throw settled2.error;
        }
        if (settled1 || settled2) {
          throw new Error(
            'retry_jobs finished without waiting for the shared parent lock',
          );
        }
        const holds1 = await advisoryGranted(
          retry1Pid,
          earlier.queue,
          earlier.id,
        );
        const holds2 = await advisoryGranted(
          retry2Pid,
          earlier.queue,
          earlier.id,
        );
        const waitsLater1 = await advisoryWaitingOn(
          retry1Pid,
          later.queue,
          later.id,
        );
        const waitsLater2 = await advisoryWaitingOn(
          retry2Pid,
          later.queue,
          later.id,
        );
        const waitsEarlier1 = await advisoryWaitingOn(
          retry1Pid,
          earlier.queue,
          earlier.id,
        );
        const waitsEarlier2 = await advisoryWaitingOn(
          retry2Pid,
          earlier.queue,
          earlier.id,
        );
        // One retry holds the earlier shared key and waits on the blocker for
        // the later key. The other waits for that earlier key. Both therefore
        // lock each selected parent, own key included, before any row lock,
        // and they take those keys in the same order.
        const leaderIs1 =
          holds1 &&
          !holds2 &&
          waitsLater1 &&
          waitsEarlier2 &&
          (await blockingPids(retry1Pid)).includes(blockerPid);
        const leaderIs2 =
          holds2 &&
          !holds1 &&
          waitsLater2 &&
          waitsEarlier1 &&
          (await blockingPids(retry2Pid)).includes(blockerPid);
        expect(leaderIs1 || leaderIs2).toBe(true);
      });

      const { rows: tuples } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_locks
          WHERE pid = ANY($1::int[]) AND locktype = 'tuple'`,
        [[retry1Pid, retry2Pid]],
      );
      expect(tuples[0].n).toBe(0);

      await blocker.query('COMMIT');
      const outcome1 = await pending1;
      const outcome2 = await pending2;
      if (outcome1.error) {
        throw outcome1.error;
      }
      if (outcome2.error) {
        throw outcome2.error;
      }
      expect(outcome1.n).toBe(2);
      expect(outcome2.n).toBe(2);

      const { rows: jobs } = await blocker.query<{
        queue: string;
        id: string;
        state: string;
        pending_deps: number;
      }>(
        `SELECT queue, id, state, pending_deps::int AS pending_deps FROM job
          WHERE queue = ANY($1::text[]) ORDER BY queue, id`,
        [[q1, q2]],
      );
      expect(jobs).toEqual([
        { queue: q1, id: 'C2', state: 'waiting', pending_deps: 0 },
        { queue: q1, id: 'P1', state: 'waiting', pending_deps: 1 },
        { queue: q2, id: 'C1', state: 'waiting', pending_deps: 0 },
        { queue: q2, id: 'P2', state: 'waiting', pending_deps: 1 },
      ]);
    } finally {
      await blocker.query('ROLLBACK');
      await pending1;
      await pending2;
      blocker.release();
      retry1.release();
      retry2.release();
    }
  });

  it('locks a nested parent before its grandparent, matching move_to_failed', async () => {
    const queue = `nest-${randomUUID()}`;
    const blocker = await pool.connect();
    const fail = await pool.connect();
    const retry = await pool.connect();
    let failing: Promise<{ error?: Error }> | undefined;
    let retrying: Promise<{ error?: Error; n?: number }> | undefined;
    try {
      await withSchema(blocker);
      await withSchema(fail);
      await withSchema(retry);
      // Old retry_jobs locked parent keys by hashtext. Pick a grandparent
      // whose key sorts before the parent's, the order that deadlocks with
      // move_to_failed (own key, then parent key).
      const { rows: pair } = await blocker.query<{ g: string; p: string }>(
        `SELECT g::text AS g, p::text AS p
           FROM generate_series(1, 40) AS g
           CROSS JOIN generate_series(1, 40) AS p
          WHERE hashtext('bullmq:parent:' || $1 || ':' || g::text)
              < hashtext('bullmq:parent:' || $1 || ':' || p::text)
          LIMIT 1`,
        [queue],
      );
      const grandparent = pair[0].g;
      const parent = pair[0].p;
      await blocker.query(
        `INSERT INTO job (
           queue, id, seq, name, state, data, opts, added_at_ms,
           finished_at_ms, pending_deps, parent_queue, parent_id, lock_token
         ) VALUES
           ($1, $2, 1, 'g', 'waiting-children', '{}', '{}', 1, NULL, 1, NULL, NULL, NULL),
           ($1, $3, 2, 'p', 'active', '{}', '{}', 1, NULL, 0, $1, $2, 'tok'),
           ($1, 'C', 3, 'c', 'completed', '{}', '{}', 1, 20, 0, $1, $3, NULL),
           ($1, 'S', 4, 's', 'completed', '{}', '{}', 1, 21, 0, $1, $2, NULL)`,
        [queue, grandparent, parent],
      );
      await blocker.query(
        `INSERT INTO job_dependency (
           parent_queue, parent_id, child_queue, child_id, child_key, status
         ) VALUES
           ($1, $2, $1, $3, $1 || ':' || $3, 'pending'),
           ($1, $2, $1, 'S', $1 || ':S', 'processed'),
           ($1, $3, $1, 'C', $1 || ':C', 'processed')`,
        [queue, grandparent, parent],
      );

      const blockerPid = (
        await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0].pid;
      const failPid = (
        await fail.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0].pid;
      const retryPid = (
        await retry.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0].pid;

      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT pg_advisory_xact_lock(hashtext('bullmq:parent:' || $1 || ':' || $2))`,
        [queue, grandparent],
      );

      let failSettled: { error?: Error } | undefined;
      failing = fail
        .query(
          `SELECT move_to_failed($1, $2, 'tok', 'boom', '[]'::jsonb, 100, false, NULL, NULL)`,
          [queue, parent],
        )
        .then(
          () => {
            failSettled = {};
            return failSettled;
          },
          (error: Error) => {
            failSettled = { error };
            return failSettled;
          },
        );
      await vi.waitFor(async () => {
        if (failSettled?.error) {
          throw failSettled.error;
        }
        expect(await blockingPids(failPid)).toContain(blockerPid);
        expect(await advisoryGranted(failPid, queue, parent)).toBe(true);
        expect(await advisoryWaitingOn(failPid, queue, grandparent)).toBe(true);
      });

      let retrySettled: { error?: Error; n?: number } | undefined;
      retrying = retry
        .query(`SELECT retry_jobs($1, 'completed', NULL, NULL) AS n`, [queue])
        .then(
          result => {
            retrySettled = { n: Number(result.rows[0].n) };
            return retrySettled;
          },
          (error: Error) => {
            retrySettled = { error };
            return retrySettled;
          },
        );
      await vi.waitFor(async () => {
        if (retrySettled?.error) {
          throw retrySettled.error;
        }
        if (retrySettled) {
          throw new Error('retry_jobs finished without waiting for the parent');
        }
        // move_to_failed holds the parent and waits for the grandparent.
        // retry must wait on that parent key, not on the grandparent.
        expect(await advisoryWaitingOn(retryPid, queue, parent)).toBe(true);
        expect(await advisoryWaitingOn(retryPid, queue, grandparent)).toBe(
          false,
        );
        expect(await blockingPids(failPid)).not.toContain(retryPid);
      });

      await blocker.query('COMMIT');
      const failed = await failing;
      const retried = await retrying;
      if (failed.error) {
        throw failed.error;
      }
      if (retried.error) {
        throw retried.error;
      }
      expect(retried.n).toBe(2);

      const { rows } = await blocker.query<{
        id: string;
        state: string;
        pending_deps: number;
      }>(
        `SELECT id, state, pending_deps::int AS pending_deps FROM job
          WHERE queue = $1 ORDER BY id`,
        [queue],
      );
      const byId = Object.fromEntries(rows.map(row => [row.id, row]));
      expect(byId.C.state).toBe('waiting');
      expect(byId.S.state).toBe('waiting');
      expect(byId[parent].state).toBe('failed');
      expect(byId[parent].pending_deps).toBe(1);
      expect(byId[grandparent].pending_deps).toBe(2);
    } finally {
      await blocker.query('ROLLBACK');
      await failing;
      await retrying;
      blocker.release();
      fail.release();
      retry.release();
    }
  });

  it('moves at most 1000 jobs when count is omitted and still honors an explicit count', async () => {
    const queue = `batch-${randomUUID()}`;
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(
        `INSERT INTO job (
           queue, id, seq, name, state, data, opts, added_at_ms, finished_at_ms
         )
         SELECT $1, i::text, i, 'n', 'completed', '{}', '{}', 1, i
           FROM generate_series(1, 1001) AS i`,
        [queue],
      );
      const first = await client.query<{ n: number }>(
        `SELECT retry_jobs($1, 'completed', NULL, NULL) AS n`,
        [queue],
      );
      expect(Number(first.rows[0].n)).toBe(1000);
      const second = await client.query<{ n: number }>(
        `SELECT retry_jobs($1, 'completed', NULL, NULL) AS n`,
        [queue],
      );
      expect(Number(second.rows[0].n)).toBe(1);

      await client.query(
        `INSERT INTO job (
           queue, id, seq, name, state, data, opts, added_at_ms, finished_at_ms
         )
         SELECT $1, i::text, i, 'n', 'failed', '{}', '{}', 1, i
           FROM generate_series(2000, 2004) AS i`,
        [queue],
      );
      const limited = await client.query<{ n: number }>(
        `SELECT retry_jobs($1, 'failed', 2, NULL) AS n`,
        [queue],
      );
      expect(Number(limited.rows[0].n)).toBe(2);
      const rest = await client.query<{ n: number }>(
        `SELECT retry_jobs($1, 'failed', 10, NULL) AS n`,
        [queue],
      );
      expect(Number(rest.rows[0].n)).toBe(3);
    } finally {
      client.release();
    }
  });
});
