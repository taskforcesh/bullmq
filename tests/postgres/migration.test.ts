import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import {
  assertPostgresVersion,
  DEFAULT_SCHEMA,
  LATEST_SCHEMA_VERSION,
  MIGRATION_ADVISORY_LOCK_KEY,
  MINIMUM_POSTGRES_VERSION,
  PostgresConnection,
  RECOMMENDED_POSTGRES_VERSION,
  runMigrations,
  SchemaVersionMismatchError,
  UnsupportedPostgresVersionError,
} from '../../src/postgres';
import { getPostgresUrl } from './utils/postgres-url';

/**
 * These tests exercise the migration subsystem against a live PostgreSQL
 * server (assumed to be already running, like the Redis suites assume Redis).
 *
 * All BullMQ objects live in a dedicated schema (the connection-level
 * namespace, default `bullmq`), so each test starts from a clean slate by
 * dropping that schema.
 */
describe('PostgreSQL migrations', () => {
  const url = getPostgresUrl();
  const schema = DEFAULT_SCHEMA;
  let pool: Pool;

  const dropAll = async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await dropAll();
  });

  afterAll(async () => {
    await dropAll();
    await pool.end();
  });

  it('migrates a fresh database up to the latest schema version', async () => {
    const connection = new PostgresConnection(url);
    try {
      await connection.waitUntilReady();

      const { rows } = await pool.query<{ version: number }>(
        `SELECT COALESCE(MAX(version), 0)::int AS version FROM "${schema}".bullmq_migration`,
      );
      expect(rows[0].version).toBe(LATEST_SCHEMA_VERSION);

      // The v1 schema creates the meta table inside the namespace schema.
      const { rows: metaRows } = await pool.query<{ exists: boolean }>(
        `SELECT to_regclass('"${schema}".bullmq_meta') IS NOT NULL AS exists`,
      );
      expect(metaRows[0].exists).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it('creates the v2 core schema (tables, enums, indexes) in the namespace', async () => {
    const connection = new PostgresConnection(url);
    try {
      await connection.waitUntilReady();

      const tables = [
        'bullmq_job',
        'bullmq_job_log',
        'bullmq_job_dependency',
        'bullmq_event',
        'bullmq_metrics',
        'bullmq_rate_limit',
        'bullmq_dedup',
        'bullmq_scheduler',
      ];
      for (const table of tables) {
        const { rows } = await pool.query<{ exists: boolean }>(
          `SELECT to_regclass('"${schema}".${table}') IS NOT NULL AS exists`,
        );
        expect(rows[0].exists, `table ${table}`).toBe(true);
      }

      // Enums are namespaced to the schema.
      const { rows: enumRows } = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = $1
           AND t.typname IN ('bullmq_job_state', 'bullmq_dep_status')`,
        [schema],
      );
      expect(enumRows[0].n).toBe(2);

      // The partial index that powers the "claim next ready job" hot path.
      const { rows: idxRows } = await pool.query<{ exists: boolean }>(
        `SELECT to_regclass('"${schema}".bullmq_job_ready_idx') IS NOT NULL AS exists`,
      );
      expect(idxRows[0].exists).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it('is idempotent (re-running does not change the version)', async () => {
    // First run.
    const first = new PostgresConnection(url);
    await first.waitUntilReady();
    await first.close();

    const { rows: before } = await pool.query<{ version: number; n: number }>(
      `SELECT COALESCE(MAX(version), 0)::int AS version, COUNT(*)::int AS n FROM "${schema}".bullmq_migration`,
    );

    // Second run on a brand-new connection.
    const second = new PostgresConnection(url);
    await second.waitUntilReady();
    await second.close();

    const { rows: after } = await pool.query<{ version: number; n: number }>(
      `SELECT COALESCE(MAX(version), 0)::int AS version, COUNT(*)::int AS n FROM "${schema}".bullmq_migration`,
    );

    expect(after[0].version).toBe(before[0].version);
    expect(after[0].n).toBe(before[0].n);
  });

  it('throws when the database schema is newer than supported', async () => {
    // Ensure the ledger exists, then record a version from the "future".
    const bootstrap = new PostgresConnection(url);
    await bootstrap.waitUntilReady();
    await bootstrap.close();

    const futureVersion = LATEST_SCHEMA_VERSION + 1;
    await pool.query(
      `INSERT INTO "${schema}".bullmq_migration (version, name) VALUES ($1, $2)`,
      [futureVersion, 'future'],
    );

    const client = await pool.connect();
    try {
      await expect(runMigrations(client, schema)).rejects.toBeInstanceOf(
        SchemaVersionMismatchError,
      );
    } finally {
      client.release();
      await pool.query(
        `DELETE FROM "${schema}".bullmq_migration WHERE version = $1`,
        [futureVersion],
      );
    }
  });

  it('rolls back atomically when a migration fails', async () => {
    await dropAll();

    const client = await pool.connect();
    try {
      // Simulate a migration set whose first statements succeed but which then
      // fails — all inside the single migration transaction.
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        MIGRATION_ADVISORY_LOCK_KEY,
        schema,
      ]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      await client.query(
        'CREATE TABLE bullmq_scratch_atomic (id int PRIMARY KEY)',
      );
      // Now force a failure.
      await expect(client.query('THIS IS NOT VALID SQL')).rejects.toBeTruthy();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // The scratch table must not exist: the whole transaction was rolled back.
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('"${schema}".bullmq_scratch_atomic') IS NOT NULL AS exists`,
    );
    expect(rows[0].exists).toBe(false);
  });
});

describe('PostgreSQL server-version check', () => {
  // A minimal PgQueryable stub that reports a fixed server version, so we can
  // exercise the thresholds without an actual old/new server.
  const clientReporting = (major: number) => {
    const num = String(major * 10000 + 1);
    return {
      query: async () => ({
        rows: [{ num, ver: `${major}.0` }],
      }),
    } as any;
  };

  it('accepts a server at or above the minimum version', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(
        assertPostgresVersion(clientReporting(MINIMUM_POSTGRES_VERSION)),
      ).resolves.toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('throws UnsupportedPostgresVersionError below the minimum version', async () => {
    await expect(
      assertPostgresVersion(clientReporting(MINIMUM_POSTGRES_VERSION - 1)),
    ).rejects.toBeInstanceOf(UnsupportedPostgresVersionError);
  });

  it('warns (but does not throw) below the recommended version', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(
        assertPostgresVersion(
          clientReporting(RECOMMENDED_POSTGRES_VERSION - 1),
        ),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  it('skips the check entirely when skipVersionCheck is set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A client that would throw if queried proves the check never runs.
    const throwingClient = {
      query: async () => {
        throw new Error('should not be queried when skipVersionCheck is set');
      },
    } as any;
    try {
      await expect(
        assertPostgresVersion(throwingClient, true),
      ).resolves.toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
