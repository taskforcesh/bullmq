import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
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
      connection: { connectionString: url, schema, migrate: true },
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    // Clean slate so migrations re-run from scratch.
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it.each([
    { fail: false, fetch: false },
    { fail: true, fetch: false },
    { fail: false, fetch: true },
    { fail: true, fetch: true },
  ])(
    'coordinates forced obliteration with finalization (%j)',
    async ({ fail, fetch }) => {
      const backend = newBackend();
      const blocker = await pool.connect();
      const finisher = await pool.connect();
      const obliterator = await pool.connect();
      let finishing:
        | Promise<
            { rows: unknown[]; error?: never } | { error: Error; rows?: never }
          >
        | undefined;
      let obliteration:
        | Promise<
            { code: number; error?: never } | { error: Error; code?: never }
          >
        | undefined;
      try {
        await backend.waitUntilReady();
        const queue = `force-finish-${randomUUID()}`;
        const now = Date.now();
        const token = randomUUID();
        for (const client of [blocker, finisher, obliterator]) {
          await client.query(`SET search_path TO "${schema}"`);
          await client.query("SET statement_timeout TO '5s'");
        }
        await blocker.query(
          `SELECT add_job($1, 'winner', 'original', '{}'::jsonb,
           '{}'::jsonb, 0, 0, $2, 1, NULL, NULL, NULL, 'key', NULL, false)`,
          [queue, now],
        );
        await blocker.query(
          'SELECT * FROM move_to_active($1, $2, 30000, $3, NULL, NULL, NULL)',
          [queue, token, now],
        );
        await blocker.query(
          `INSERT INTO meta(queue, field, value) VALUES ($1, 'paused', '1')`,
          [queue],
        );
        const { rows: finishPid } = await finisher.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        const { rows: obliteratePid } = await obliterator.query<{
          pid: number;
        }>('SELECT pg_backend_pid() AS pid');
        const { rows: blockerPid } = await blocker.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        await blocker.query('BEGIN');
        // Stop the actual finish function after it has locked/updated the job,
        // immediately before no-TTL dedup finalization.
        await blocker.query(
          `SELECT pg_advisory_xact_lock(hashtext('bullmq:dedup:' || $1 || ':key'))`,
          [queue],
        );
        const fn = fail ? 'move_to_failed' : 'move_to_completed';
        const args: unknown[] = [
          queue,
          'winner',
          token,
          fail ? 'failed' : '{}',
        ];
        if (fail) {
          args.push('[]');
        }
        args.push(now, false, null, null);
        if (fetch) {
          args.push(30000, now, null, null, null);
        }
        const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
        finishing = finisher
          .query(
            `SELECT * FROM ${fn}${fetch ? '_fetch' : ''}(${placeholders})`,
            args,
          )
          .then(
            result => ({ rows: result.rows }),
            (error: Error) => ({ error }),
          );
        await vi.waitFor(async () => {
          const { rows } = await pool.query<{ blockers: number[] }>(
            'SELECT pg_blocking_pids($1) AS blockers',
            [finishPid[0].pid],
          );
          expect(rows[0].blockers).toContain(blockerPid[0].pid);
        });
        obliteration = obliterator
          .query<{ code: number }>('SELECT obliterate($1, 10, true) AS code', [
            queue,
          ])
          .then(
            result => ({ code: result.rows[0].code }),
            (error: Error) => ({ error }),
          );
        await vi.waitFor(async () => {
          const { rows } = await pool.query<{ blockers: number[] }>(
            'SELECT pg_blocking_pids($1) AS blockers',
            [obliteratePid[0].pid],
          );
          expect(rows[0].blockers).toContain(finishPid[0].pid);
        });
        // An obliterator waiting on the common lock must not own the dedup row.
        await blocker.query(
          "SELECT dedup_id FROM dedup WHERE queue = $1 AND dedup_id = 'key' FOR UPDATE NOWAIT",
          [queue],
        );
        // Unrelated queues are not excluded by the queue-scoped protocol.
        const { rows: locks } = await blocker.query<{
          unrelated: boolean;
        }>(
          `SELECT
           pg_try_advisory_xact_lock(hashtext('bullmq:finalization'), hashtext($1)) AS unrelated`,
          [`${queue}-other`],
        );
        expect(locks[0].unrelated).toBe(true);
        await blocker.query('COMMIT');
        const finished = await finishing;
        if (finished.error) {
          throw finished.error;
        }
        const deleted = await obliteration;
        if (deleted.error) {
          throw deleted.error;
        }
        expect(deleted.code).toBe(0);
        const { rows: counts } = await blocker.query<{
          jobs: string;
          keys: string;
        }>(
          `SELECT (SELECT count(*) FROM job WHERE queue = $1) AS jobs,
                (SELECT count(*) FROM dedup WHERE queue = $1) AS keys`,
          [queue],
        );
        expect(counts[0]).toEqual({ jobs: '0', keys: '0' });
      } finally {
        await blocker.query('ROLLBACK');
        if (finishing) {
          await finishing;
        }
        if (obliteration) {
          await obliteration;
        }
        blocker.release();
        finisher.release();
        obliterator.release();
        await backend.close();
      }
    },
  );

  it.each([false, true])(
    'finalization waits before job locks when forced obliteration starts first (fail: %s)',
    async fail => {
      const backend = newBackend();
      const producer = await pool.connect();
      const obliterator = await pool.connect();
      const finisher = await pool.connect();
      let deleting:
        | Promise<
            { code: number; error?: never } | { error: Error; code?: never }
          >
        | undefined;
      let finishing:
        | Promise<
            { error: Error; rows?: never } | { rows: unknown[]; error?: never }
          >
        | undefined;
      try {
        await backend.waitUntilReady();
        const queue = `obliterate-first-${randomUUID()}`;
        const now = Date.now();
        for (const client of [producer, obliterator, finisher]) {
          await client.query(`SET search_path TO "${schema}"`);
          await client.query("SET statement_timeout TO '5s'");
        }
        await producer.query(
          `SELECT add_job($1, 'winner', 'original', '{}'::jsonb,
             '{}'::jsonb, 0, 0, $2, 1, NULL, NULL, NULL, 'key', NULL, false)`,
          [queue, now],
        );
        await producer.query(
          "SELECT * FROM move_to_active($1, 'token', 30000, $2, NULL, NULL, NULL)",
          [queue, now],
        );
        await producer.query(
          `INSERT INTO meta(queue, field, value) VALUES ($1, 'paused', '1')`,
          [queue],
        );
        const { rows: deletePid } = await obliterator.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        const { rows: finishPid } = await finisher.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        const { rows: producerPid } = await producer.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        await producer.query('BEGIN');
        await producer.query(
          "SELECT dedup_id FROM dedup WHERE queue = $1 AND dedup_id = 'key' FOR UPDATE",
          [queue],
        );
        deleting = obliterator
          .query<{ code: number }>('SELECT obliterate($1, 1, true) AS code', [
            queue,
          ])
          .then(
            result => ({ code: result.rows[0].code }),
            (error: Error) => ({ error }),
          );
        await vi.waitFor(async () => {
          const { rows } = await pool.query<{ blockers: number[] }>(
            'SELECT pg_blocking_pids($1) AS blockers',
            [deletePid[0].pid],
          );
          expect(rows[0].blockers).toContain(producerPid[0].pid);
        });
        const sql = fail
          ? "SELECT move_to_failed($1, 'winner', 'token', 'failed', '[]'::jsonb, $2, false, NULL, NULL)"
          : "SELECT move_to_completed($1, 'winner', 'token', '{}'::jsonb, $2, false, NULL, NULL)";
        finishing = finisher.query(sql, [queue, now]).then(
          result => ({ rows: result.rows }),
          (error: Error) => ({ error }),
        );
        await vi.waitFor(async () => {
          const { rows } = await pool.query<{ blockers: number[] }>(
            'SELECT pg_blocking_pids($1) AS blockers',
            [finishPid[0].pid],
          );
          expect(rows[0].blockers).toContain(deletePid[0].pid);
        });
        await producer.query(
          "SELECT id FROM job WHERE queue = $1 AND id = 'winner' FOR UPDATE NOWAIT",
          [queue],
        );
        await producer.query('COMMIT');
        const deleted = await deleting;
        if (deleted.error) {
          throw deleted.error;
        }
        expect(deleted.code).toBe(1);
        const finished = await finishing;
        expect(finished.error).toMatchObject({ code: 'BM001', detail: '-1' });
        const { rows } = await obliterator.query<{ code: number }>(
          'SELECT obliterate($1, 1, true) AS code',
          [queue],
        );
        expect(rows[0].code).toBe(0);
      } finally {
        await producer.query('ROLLBACK');
        if (deleting) {
          await deleting;
        }
        if (finishing) {
          await finishing;
        }
        producer.release();
        obliterator.release();
        finisher.release();
        await backend.close();
      }
    },
  );

  it('allows shared finalizers and coordinates the direct parent queue', async () => {
    const backend = newBackend();
    const finisher = await pool.connect();
    const probe = await pool.connect();
    try {
      await backend.waitUntilReady();
      const queue = `shared-finish-${randomUUID()}`;
      const parentQueue = `${queue}-parent`;
      await finisher.query(`SET search_path TO "${schema}"`);
      const now = Date.now();
      await finisher.query(
        `SELECT add_job($1, 'parent', 'parent', '{}'::jsonb,
           '{}'::jsonb, 0, 0, $2, 1, NULL, NULL, NULL, NULL, NULL, false)`,
        [parentQueue, now],
      );
      await finisher.query(
        `SELECT add_job($1, 'child', 'child', '{}'::jsonb,
           '{}'::jsonb, 0, 0, $2, 1, $3, 'parent', $3 || ':parent', 'key', NULL, false)`,
        [queue, now, parentQueue],
      );
      await finisher.query(
        "SELECT * FROM move_to_active($1, 'token', 30000, $2, NULL, NULL, NULL)",
        [queue, now],
      );
      await finisher.query('BEGIN');
      await finisher.query(
        "SELECT move_to_completed($1, 'child', 'token', '{}'::jsonb, $2, false, NULL, NULL)",
        [queue, now],
      );
      await probe.query('BEGIN');
      for (const lockedQueue of [queue, parentQueue]) {
        const { rows } = await probe.query<{
          exclusive: boolean;
          shared: boolean;
        }>(
          `SELECT
             pg_try_advisory_xact_lock(hashtext('bullmq:finalization'), hashtext($1)) AS exclusive,
             pg_try_advisory_xact_lock_shared(hashtext('bullmq:finalization'), hashtext($1)) AS shared`,
          [lockedQueue],
        );
        expect(rows[0]).toEqual({ exclusive: false, shared: true });
      }
    } finally {
      await finisher.query('ROLLBACK');
      await probe.query('ROLLBACK');
      finisher.release();
      probe.release();
      await backend.close();
    }
  });

  it.each([1, 10])(
    'locks dedup before jobs during obliteration with batch size %i',
    async count => {
      const backend = newBackend();
      const producer = await pool.connect();
      const obliterator = await pool.connect();
      let obliteration:
        | Promise<
            { code: number; error?: never } | { error: Error; code?: never }
          >
        | undefined;
      try {
        await backend.waitUntilReady();
        const queue = `lock-order-${randomUUID()}`;
        await producer.query(`SET search_path TO "${schema}"`);
        await obliterator.query(`SET search_path TO "${schema}"`);
        const { rows: pidRows } = await obliterator.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        const now = Date.now();
        await producer.query(
          `SELECT add_job($1, 'winner', 'original', '{}'::jsonb,
             '{"delay":60000,"deduplication":{"id":"dedup"}}'::jsonb,
             0, 60000, $2, 1, NULL, NULL, NULL, 'dedup', NULL, false)`,
          [queue, now],
        );
        await producer.query(
          `INSERT INTO meta(queue, field, value) VALUES ($1, 'paused', '1')`,
          [queue],
        );
        await producer.query('BEGIN');
        await producer.query(
          `SELECT job_id FROM dedup WHERE queue = $1 AND dedup_id = 'dedup' FOR UPDATE`,
          [queue],
        );
        const { rows: holderRows } = await producer.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );

        // Record rejection immediately so a failure remains observed while
        // the producer transaction is released in finally.
        const pending = obliterator.query<{ code: number }>(
          'SELECT obliterate($1, $2, true) AS code',
          [queue, count],
        );
        obliteration = pending.then(
          result => ({ code: result.rows[0].code }),
          (error: Error) => ({ error }),
        );
        await vi.waitFor(async () => {
          const { rows } = await pool.query<{ blockers: number[] }>(
            'SELECT pg_blocking_pids($1) AS blockers',
            [pidRows[0].pid],
          );
          expect(rows[0].blockers).toContain(holderRows[0].pid);
        });

        // If obliteration took the job lock first this raises 55P03. With
        // dedup-first ordering, the producer can still finish its reschedule.
        await producer.query(
          'SELECT id FROM job WHERE queue = $1 FOR UPDATE NOWAIT',
          [queue],
        );
        const { rows } = await producer.query<{ winner: string }>(
          `SELECT deduplicate_job($1,
             '{"id":"dedup","reschedule":true}'::jsonb, 'incoming', $2,
             'incoming', '{"changed":true}'::jsonb, '{"delay":120000}'::jsonb) AS winner`,
          [queue, now],
        );
        expect(rows[0].winner).toBe('winner');
        await producer.query('COMMIT');
        const outcome = await obliteration;
        if (outcome.error) {
          throw outcome.error;
        }
        expect(outcome.code).toBe(count === 1 ? 1 : 0);
        const { rows: remaining } = await pool.query<{ count: string }>(
          `SELECT count(*) FROM "${schema}".dedup WHERE queue = $1`,
          [queue],
        );
        expect(Number(remaining[0].count)).toBe(count === 1 ? 1 : 0);
        if (count === 1) {
          const { rows: final } = await obliterator.query<{ code: number }>(
            'SELECT obliterate($1, $2, true) AS code',
            [queue, count],
          );
          expect(final[0].code).toBe(0);
        }
      } finally {
        await producer.query('ROLLBACK');
        if (obliteration) {
          await obliteration;
        }
        producer.release();
        obliterator.release();
        await backend.close();
      }
    },
  );

  it('bounds intermediate dedup locks to selected winners and their delete cascades', async () => {
    const backend = newBackend();
    const producer = await pool.connect();
    const obliterator = await pool.connect();
    try {
      await backend.waitUntilReady();
      const queue = `bounded-locks-${randomUUID()}`;
      await producer.query(`SET search_path TO "${schema}"`);
      await obliterator.query(`SET search_path TO "${schema}"`);
      await obliterator.query("SET statement_timeout TO '3s'");
      await producer.query(
        `SELECT add_job($1, n::text, 'original', '{}'::jsonb,
           '{}'::jsonb, 0, 60000, $2, 1, NULL, NULL, NULL,
           'key-' || n, NULL, false)
         FROM generate_series(0, 5) AS n`,
        [queue, Date.now()],
      );
      await producer.query(
        `SELECT add_job($1, 'z-child', 'child', '{}'::jsonb,
           '{}'::jsonb, 0, 60000, $2, 1, $1, '0', $1 || ':0',
           'child-key', NULL, false)`,
        [queue, Date.now()],
      );
      // A second key can point to a winner independently of job.dedup_id.
      await producer.query(
        `INSERT INTO dedup(queue, dedup_id, job_id) VALUES
           ($1, 'alias-key', '0'), ($1, 'orphan-key', 'missing')`,
        [queue],
      );
      await producer.query(
        `INSERT INTO job_log(queue, job_id, idx, row) VALUES ($1, '0', 0, 'log')`,
        [queue],
      );
      await producer.query(
        `INSERT INTO meta(queue, field, value) VALUES ($1, 'paused', '1')`,
        [queue],
      );
      await producer.query('BEGIN');
      // Neither the child dependency cascade nor unrelated/stale keys need
      // dedup locks in the parent's intermediate deletion batch.
      const { rows: unrelated } = await producer.query<{ dedup_id: string }>(
        `SELECT dedup_id FROM dedup WHERE queue = $1
           AND job_id <> ALL(ARRAY['0', '1']) FOR UPDATE`,
        [queue],
      );
      expect(unrelated).toHaveLength(6);
      await obliterator.query('BEGIN');
      const { rows: first } = await obliterator.query<{ code: number }>(
        'SELECT obliterate($1, 2, true) AS code',
        [queue],
      );
      expect(first[0].code).toBe(1);

      // Verify the exact lock footprint, including the alias key. NOWAIT
      // avoids relying on pg_locks' tuple-lock visibility.
      for (const dedupId of ['key-0', 'key-1', 'alias-key']) {
        await producer.query('SAVEPOINT lock_probe');
        await expect(
          producer.query(
            `SELECT dedup_id FROM dedup WHERE queue = $1
               AND dedup_id = $2 FOR UPDATE NOWAIT`,
            [queue, dedupId],
          ),
        ).rejects.toMatchObject({ code: '55P03' });
        await producer.query('ROLLBACK TO SAVEPOINT lock_probe');
        await producer.query('RELEASE SAVEPOINT lock_probe');
      }
      await obliterator.query('COMMIT');
      await producer.query('COMMIT');
      const { rows: counts } = await producer.query<{
        keys: string;
        jobs: string;
        logs: string;
        dependencies: string;
      }>(
        `SELECT
           (SELECT count(*) FROM dedup WHERE queue = $1) AS keys,
           (SELECT count(*) FROM job WHERE queue = $1) AS jobs,
           (SELECT count(*) FROM job_log WHERE queue = $1) AS logs,
           (SELECT count(*) FROM job_dependency WHERE parent_queue = $1) AS dependencies`,
        [queue],
      );
      expect(counts[0]).toEqual({
        keys: '9',
        jobs: '5',
        logs: '0',
        dependencies: '0',
      });
      // The surviving child keeps its key even after its parent's dependency
      // rows have cascaded away. Keys are retained until final cleanup.
      for (const code of [1, 1, 0]) {
        const { rows } = await obliterator.query<{ code: number }>(
          'SELECT obliterate($1, 2, true) AS code',
          [queue],
        );
        expect(rows[0].code).toBe(code);
      }
      const { rows: remaining } = await producer.query<{ count: string }>(
        'SELECT count(*) FROM dedup WHERE queue = $1',
        [queue],
      );
      expect(remaining[0].count).toBe('0');
    } finally {
      await producer.query('ROLLBACK');
      await obliterator.query('ROLLBACK');
      producer.release();
      obliterator.release();
      await backend.close();
    }
  });

  it.each([false, true])(
    'prelocks stale keys only for final cleanup (full selected batch: %s)',
    async full => {
      const backend = newBackend();
      const producer = await pool.connect();
      const obliterator = await pool.connect();
      let pending:
        | Promise<
            { code: number; error?: never } | { error: Error; code?: never }
          >
        | undefined;
      try {
        await backend.waitUntilReady();
        const queue = `final-locks-${randomUUID()}`;
        await producer.query(`SET search_path TO "${schema}"`);
        await obliterator.query(`SET search_path TO "${schema}"`);
        await obliterator.query("SET statement_timeout TO '3s'");
        await producer.query(
          `SELECT add_job($1, 'winner', 'original', '{}'::jsonb,
             '{}'::jsonb, 0, 60000, $2, 1, NULL, NULL, NULL,
             'key', NULL, false)`,
          [queue, Date.now()],
        );
        if (full) {
          await producer.query(
            `SELECT add_job($1, 'z-other', 'other', '{}'::jsonb,
               '{}'::jsonb, 0, 60000, $2, 1, NULL, NULL, NULL,
               NULL, NULL, false)`,
            [queue, Date.now()],
          );
        }
        await producer.query(
          `INSERT INTO dedup(queue, dedup_id, job_id) VALUES ($1, 'orphan', 'missing')`,
          [queue],
        );
        await producer.query(
          `INSERT INTO meta(queue, field, value) VALUES ($1, 'paused', '1')`,
          [queue],
        );
        await producer.query('BEGIN');
        await producer.query(
          `SELECT dedup_id FROM dedup WHERE queue = $1
             AND dedup_id = $2 FOR UPDATE`,
          [queue, full ? 'key' : 'orphan'],
        );
        const { rows: producerPid } = await producer.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        const { rows: obliteratorPid } = await obliterator.query<{
          pid: number;
        }>('SELECT pg_backend_pid() AS pid');
        pending = obliterator
          .query<{ code: number }>('SELECT obliterate($1, 2, true) AS code', [
            queue,
          ])
          .then(
            result => ({ code: result.rows[0].code }),
            (error: Error) => ({ error }),
          );
        await vi.waitFor(async () => {
          const { rows } = await pool.query<{ blockers: number[] }>(
            'SELECT pg_blocking_pids($1) AS blockers',
            [obliteratorPid[0].pid],
          );
          expect(rows[0].blockers).toContain(producerPid[0].pid);
        });
        await producer.query(
          "SELECT id FROM job WHERE queue = $1 AND id = 'winner' FOR UPDATE NOWAIT",
          [queue],
        );
        if (full) {
          // The selected batch was full, but concurrent deletion reduces the
          // actual DELETE count. It must not switch to final dedup cleanup.
          await producer.query(
            "DELETE FROM job WHERE queue = $1 AND id = 'z-other'",
            [queue],
          );
        }
        await producer.query('COMMIT');
        const outcome = await pending;
        if (outcome.error) {
          throw outcome.error;
        }
        expect(outcome.code).toBe(full ? 1 : 0);
        const { rows: remaining } = await producer.query<{ count: string }>(
          'SELECT count(*) FROM dedup WHERE queue = $1',
          [queue],
        );
        expect(remaining[0].count).toBe(full ? '2' : '0');
        if (full) {
          const { rows } = await obliterator.query<{ code: number }>(
            'SELECT obliterate($1, 2, true) AS code',
            [queue],
          );
          expect(rows[0].code).toBe(0);
        }
      } finally {
        await producer.query('ROLLBACK');
        if (pending) {
          await pending;
        }
        producer.release();
        obliterator.release();
        await backend.close();
      }
    },
  );

  it.each([false, true])(
    'prelocks bulk dedup keys before concurrent finish-and-fetch (reversed: %s)',
    async reversed => {
      const backend = newBackend();
      const worker = await pool.connect();
      const batch = await pool.connect();
      let pending:
        | Promise<
            { ids: string[]; error?: never } | { error: Error; ids?: never }
          >
        | undefined;
      try {
        await backend.waitUntilReady();
        const queue = `bulk-lock-${randomUUID()}`;
        const now = Date.now();
        const token = randomUUID();
        await worker.query(`SET search_path TO "${schema}"`);
        await batch.query(`SET search_path TO "${schema}"`);
        await worker.query("SET statement_timeout TO '5s'");
        await batch.query("SET statement_timeout TO '5s'");
        const { rows: keys } = await worker.query<{ id: string; key: number }>(
          `SELECT id, hashtext('bullmq:dedup:' || $1 || ':' || id) AS key
             FROM unnest(ARRAY['first', 'second']) AS id ORDER BY key`,
          [queue],
        );
        const [bKey, aKey] = keys;
        const add = async (id: string, dedupId: string, delay: number) => {
          await worker.query(
            `SELECT add_job($1, $2, $2, '{"original":true}'::jsonb, $3::jsonb,
               0, $4, $5, 1, NULL, NULL, NULL, $6, NULL, false)`,
            [
              queue,
              id,
              JSON.stringify({
                delay,
                deduplication: { id: dedupId, ttl: 600000 },
              }),
              delay,
              now - 1000,
              dedupId,
            ],
          );
        };
        await add('A', aKey.id, 0);
        const { rows: active } = await worker.query<{ id: string }>(
          'SELECT id FROM move_to_active($1, $2, 30000, $3, NULL, NULL, NULL)',
          [queue, token, now],
        );
        expect(active.map(job => job.id)).toEqual(['A']);
        await add('B', bKey.id, 1);

        await worker.query('BEGIN');
        await worker.query('SELECT pg_advisory_xact_lock($1)', [aKey.key]);
        const { rows: workerPid } = await worker.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        const { rows: batchPid } = await batch.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        );
        const entries = [
          { id: 'incoming-B', dedupId: bKey.id },
          { id: 'incoming-A', dedupId: aKey.id },
        ].map(entry => ({
          ...entry,
          queue,
          name: 'incoming',
          data: '{"changed":true}',
          timestamp: now - 1000,
          delay: 1,
          opts: {
            delay: 1,
            deduplication: { id: entry.dedupId, reschedule: true },
          },
        }));
        if (reversed) {
          entries.reverse();
        }
        pending = batch
          .query<{ id: string }>('SELECT add_flow($1::jsonb) AS id', [
            JSON.stringify(entries),
          ])
          .then(
            result => ({ ids: result.rows.map(row => row.id) }),
            (error: Error) => ({ error }),
          );
        await vi.waitFor(async () => {
          const { rows } = await pool.query<{ blockers: number[] }>(
            'SELECT pg_blocking_pids($1) AS blockers',
            [batchPid[0].pid],
          );
          expect(rows[0].blockers).toContain(workerPid[0].pid);
        });

        // Both input orders must acquire B's smaller key before waiting on A,
        // but neither may update B until every advisory lock is held.
        const { rows: lock } = await worker.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_xact_lock($1) AS acquired',
          [bKey.key],
        );
        expect(lock[0].acquired).toBe(false);
        await worker.query(
          "SELECT id FROM job WHERE queue = $1 AND id = 'B' FOR UPDATE NOWAIT",
          [queue],
        );
        const { rows: fetched } = await worker.query<{
          id: string;
          state: string;
          data: { original: boolean };
        }>(
          `SELECT id, state, data FROM move_to_completed_fetch(
             $1, 'A', $2, '{}'::jsonb, $3, false, NULL, NULL,
             30000, $3, NULL, NULL, NULL)`,
          [queue, token, now],
        );
        expect(fetched).toEqual([
          { id: 'B', state: 'active', data: { original: true } },
        ]);
        await worker.query('COMMIT');
        const outcome = await pending;
        if (outcome.error) {
          throw outcome.error;
        }
        expect(outcome.ids).toEqual(reversed ? ['A', 'B'] : ['B', 'A']);
        const { rows: jobs } = await worker.query<{
          id: string;
          state: string;
          delay_ms: string;
          data: { original: boolean };
        }>(
          'SELECT id, state, delay_ms, data FROM job WHERE queue = $1 ORDER BY id',
          [queue],
        );
        expect(jobs).toEqual([
          {
            id: 'A',
            state: 'completed',
            delay_ms: '0',
            data: { original: true },
          },
          { id: 'B', state: 'active', delay_ms: '0', data: { original: true } },
        ]);
      } finally {
        await worker.query('ROLLBACK');
        if (pending) {
          await pending;
        }
        worker.release();
        batch.release();
        await backend.close();
      }
    },
  );

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

  describe('deduplication reschedule', () => {
    it.each([false, true])(
      'preserves payload and updates the due time (extend=%s)',
      async extend => {
        const backend = newBackend();
        try {
          await backend.waitUntilReady();
          const id = randomUUID();
          const timestamp = Date.now() + 60000;
          const deduplication = { id: 'reschedule', ttl: 30000, extend };
          await backend.addJob(
            makeJob({
              timestamp,
              delay: 10000,
              opts: { delay: 10000, deduplication },
              deduplicationId: deduplication.id,
            }),
            id,
          );
          for (const delay of [2000, 20000]) {
            const incoming = makeJob({
              timestamp: timestamp + 1000,
              name: 'incoming',
              data: '{"foo":"baz"}',
              delay,
              opts: {
                deduplication: {
                  ...deduplication,
                  ttl: 60000,
                  reschedule: true,
                },
              },
              deduplicationId: deduplication.id,
            });
            expect(
              await backend.addJobs([{ job: incoming, jobId: randomUUID() }]),
            ).toEqual([id]);
            const stored = await backend.getJobData(id);
            expect(stored?.name).toBe('test-job');
            expect(JSON.parse(stored!.data)).toEqual({ foo: 'bar' });
            expect(stored?.delay).toBe(delay);
            expect(await backend.getState(id)).toBe('delayed');
            const { rows } = await pool.query<{
              process_at_ms: string;
              expire_at_ms: string;
            }>(
              `SELECT j.process_at_ms, d.expire_at_ms
                 FROM "${schema}".job j
                 JOIN "${schema}".dedup d ON d.queue = j.queue AND d.job_id = j.id
                WHERE j.id = $1`,
              [id],
            );
            expect(Number(rows[0].process_at_ms)).toBe(
              timestamp + 1000 + delay,
            );
            expect(Number(rows[0].expire_at_ms)).toBe(
              extend ? timestamp + 1000 + 60000 : timestamp + 30000,
            );
          }
          expect(await backend.getCounts(['delayed'])).toEqual([1]);
        } finally {
          await backend.close();
        }
      },
    );

    it('uses the top-level delay when rescheduling with addJob', async () => {
      const backend = newBackend();
      try {
        await backend.waitUntilReady();
        const deduplication = { id: 'reschedule-add-job' };
        const id = await backend.addJob(
          makeJob({
            delay: 10000,
            opts: { delay: 10000, deduplication },
            deduplicationId: deduplication.id,
          }),
          'original',
        );

        expect(
          await backend.addJob(
            makeJob({
              timestamp: Date.now() + 60000,
              delay: 20000,
              opts: {
                deduplication: { ...deduplication, reschedule: true },
              },
              deduplicationId: deduplication.id,
            }),
            'incoming',
          ),
        ).toBe(id);
        expect((await backend.getJobData(id))?.delay).toBe(20000);
      } finally {
        await backend.close();
      }
    });

    it('makes a delayed job due without changing an active job', async () => {
      const backend = newBackend();
      try {
        await backend.waitUntilReady();
        const deduplication = { id: 'due', reschedule: true };
        const id = await backend.addJob(
          makeJob({
            delay: 60000,
            opts: { delay: 60000, deduplication },
            deduplicationId: deduplication.id,
          }),
          'original',
        );
        expect(
          await backend.addJob(
            makeJob({
              opts: { deduplication },
              deduplicationId: deduplication.id,
            }),
            'incoming',
          ),
        ).toBe(id);
        const [, claimedId] = await backend.moveToActive(randomUUID());
        expect(claimedId).toBe(id);
        await backend.addJob(
          makeJob({
            delay: 60000,
            opts: { delay: 60000, deduplication },
            deduplicationId: deduplication.id,
          }),
          'another',
        );
        expect(await backend.getState(id)).toBe('active');
        expect((await backend.getJobData(id))?.delay).toBe(0);
      } finally {
        await backend.close();
      }
    });
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

  it('removeOnComplete: { age: -1 } keeps the job (negative keep-age disables age trimming)', async () => {
    const backend = newBackend();
    try {
      await backend.waitUntilReady();
      const token = randomUUID();
      const id = await backend.addJob(makeJob(), '');
      await backend.moveToActive(token);

      await backend.moveToCompleted(
        { id } as any,
        1,
        { age: -1 } as any,
        token,
        false,
      );

      expect(await backend.getState(id)).toBe('completed');
      expect(await backend.getJobData(id)).toBeTruthy();
    } finally {
      await backend.close();
    }
  });

  describe('deduplication when the winner job no longer exists', () => {
    const dedupJob = (dedupId: string) =>
      makeJob({
        opts: { deduplication: { id: dedupId } },
        deduplicationId: dedupId,
      } as Partial<JobJson>);

    it('recovers the stale key on a single add', async () => {
      const backend = newBackend();
      try {
        await backend.waitUntilReady();
        const dedupId = 'stale-single';

        expect(await backend.addJob(dedupJob(dedupId), 'a1')).toBe('a1');
        expect(await backend.getDeduplicationJobId(dedupId)).toBe('a1');

        // `drain` deletes the job row but leaves the deduplication row behind,
        // so the key now points at a job that no longer exists.
        await backend.drain(false);
        expect(await backend.getJobData('a1')).toBeUndefined();
        expect(await backend.getDeduplicationJobId(dedupId)).toBe('a1');

        expect(await backend.addJob(dedupJob(dedupId), 'a2')).toBe('a2');
        expect(await backend.getJobData('a2')).toBeTruthy();
        expect(await backend.getDeduplicationJobId(dedupId)).toBe('a2');
      } finally {
        await backend.close();
      }
    });

    it('recovers the stale key on a bulk add', async () => {
      const backend = newBackend();
      try {
        await backend.waitUntilReady();
        const dedupId = 'stale-bulk';

        expect(
          await backend.addJobs([{ job: dedupJob(dedupId), jobId: 'b1' }]),
        ).toEqual(['b1']);
        expect(await backend.getDeduplicationJobId(dedupId)).toBe('b1');

        // `clean` also deletes the job row without clearing the dedup row.
        expect(
          await backend.cleanJobsByState('wait', Date.now() + 1000, 0),
        ).toEqual(['b1']);
        expect(await backend.getJobData('b1')).toBeUndefined();
        expect(await backend.getDeduplicationJobId(dedupId)).toBe('b1');

        expect(
          await backend.addJobs([{ job: dedupJob(dedupId), jobId: 'b2' }]),
        ).toEqual(['b2']);
        expect(await backend.getJobData('b2')).toBeTruthy();
        expect(await backend.getDeduplicationJobId(dedupId)).toBe('b2');
      } finally {
        await backend.close();
      }
    });

    it('still deduplicates while the winner job exists', async () => {
      const backend = newBackend();
      try {
        await backend.waitUntilReady();
        const dedupId = 'live-winner';

        expect(await backend.addJob(dedupJob(dedupId), 'c1')).toBe('c1');
        // The winner is still there, so the second add is deduplicated.
        expect(await backend.addJob(dedupJob(dedupId), 'c2')).toBe('c1');
        expect(await backend.getJobData('c2')).toBeUndefined();

        expect(
          await backend.addJobs([{ job: dedupJob(dedupId), jobId: 'c3' }]),
        ).toEqual(['c1']);
        expect(await backend.getJobData('c3')).toBeUndefined();
        expect(await backend.getDeduplicationJobId(dedupId)).toBe('c1');
      } finally {
        await backend.close();
      }
    });
  });
});
