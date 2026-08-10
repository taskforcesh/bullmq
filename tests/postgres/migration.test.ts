import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Pool } from 'pg';
import {
  assertPostgresVersion,
  assertSchemaCompatibility,
  BULLMQ_MAJOR_VERSION,
  DEFAULT_SCHEMA,
  LATEST_SCHEMA_VERSION,
  MIGRATION_ADVISORY_LOCK_KEY,
  MINIMUM_POSTGRES_VERSION,
  PostgresConnection,
  RECOMMENDED_POSTGRES_VERSION,
  runMigrations,
  SchemaMigrationRequiredError,
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
  });

  beforeEach(dropAll);

  afterAll(async () => {
    await dropAll();
    await pool.end();
  });

  it('migrates a fresh database up to the latest schema version', async () => {
    const connection = new PostgresConnection({
      connectionString: url,
      migrate: true,
    });
    try {
      await connection.waitUntilReady();

      const { rows } = await pool.query<{ version: number }>(
        `SELECT COALESCE(MAX(version), 0)::int AS version FROM "${schema}".migration`,
      );
      expect(rows[0].version).toBe(LATEST_SCHEMA_VERSION);

      // The v1 schema creates the meta table inside the namespace schema.
      const { rows: metaRows } = await pool.query<{ exists: boolean }>(
        `SELECT to_regclass('"${schema}".meta') IS NOT NULL AS exists`,
      );
      expect(metaRows[0].exists).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it('creates the v2 core schema (tables, enums, indexes) in the namespace', async () => {
    const connection = new PostgresConnection({
      connectionString: url,
      migrate: true,
    });
    try {
      await connection.waitUntilReady();

      const tables = [
        'job',
        'job_log',
        'job_dependency',
        'event',
        'metrics',
        'rate_limit',
        'dedup',
        'scheduler',
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
           AND t.typname IN ('job_state', 'dep_status')`,
        [schema],
      );
      expect(enumRows[0].n).toBe(2);

      // The partial index that powers the "claim next ready job" hot path.
      const { rows: idxRows } = await pool.query<{ exists: boolean }>(
        `SELECT to_regclass('"${schema}".job_ready_idx') IS NOT NULL AS exists`,
      );
      expect(idxRows[0].exists).toBe(true);
    } finally {
      await connection.close();
    }
  });

  it('is idempotent (re-running does not change the version)', async () => {
    // First run.
    const first = new PostgresConnection({
      connectionString: url,
      migrate: true,
    });
    await first.waitUntilReady();
    await first.close();

    const { rows: before } = await pool.query<{ version: number; n: number }>(
      `SELECT COALESCE(MAX(version), 0)::int AS version, COUNT(*)::int AS n FROM "${schema}".migration`,
    );

    // Second run on a brand-new connection.
    const second = new PostgresConnection({
      connectionString: url,
      migrate: true,
    });
    await second.waitUntilReady();
    await second.close();

    const { rows: after } = await pool.query<{ version: number; n: number }>(
      `SELECT COALESCE(MAX(version), 0)::int AS version, COUNT(*)::int AS n FROM "${schema}".migration`,
    );

    expect(after[0].version).toBe(before[0].version);
    expect(after[0].n).toBe(before[0].n);
  });

  it('does not create or migrate a schema by default', async () => {
    const connection = new PostgresConnection(url);
    try {
      await expect(connection.waitUntilReady()).rejects.toBeInstanceOf(
        SchemaMigrationRequiredError,
      );
      const { rows } = await pool.query<{ exists: boolean }>(
        `SELECT to_regnamespace($1) IS NOT NULL AS exists`,
        [schema],
      );
      expect(rows[0].exists).toBe(false);
    } finally {
      await connection.close();
    }
  });

  it('accepts newer same-major schemas and rejects a newer required major', async () => {
    const bootstrap = new PostgresConnection({
      connectionString: url,
      migrate: true,
    });
    await bootstrap.waitUntilReady();
    await bootstrap.close();

    const futureVersion = LATEST_SCHEMA_VERSION + 1;
    await pool.query(
      `INSERT INTO "${schema}".migration
         (version, name, min_client_version)
       VALUES ($1, $2, $3)`,
      [futureVersion, 'future-compatible', BULLMQ_MAJOR_VERSION],
    );

    const compatible = new PostgresConnection({ connectionString: url });
    try {
      await expect(compatible.waitUntilReady()).resolves.toBeUndefined();
    } finally {
      await compatible.close();
    }

    const readOnly = new PostgresConnection({
      connectionString: url,
      skipMigrations: true,
    });
    try {
      await expect(readOnly.waitUntilReady()).resolves.toBeUndefined();
    } finally {
      await readOnly.close();
    }

    await pool.query(
      `UPDATE "${schema}".migration
          SET min_client_version = $1
        WHERE version = $2`,
      [BULLMQ_MAJOR_VERSION + 1, futureVersion],
    );
    const incompatible = new PostgresConnection({
      connectionString: url,
      skipMigrations: true,
    });

    try {
      await expect(incompatible.waitUntilReady()).rejects.toBeInstanceOf(
        SchemaVersionMismatchError,
      );
    } finally {
      await incompatible.close();
    }
  });

  it('rejects conflicting migration modes', () => {
    expect(
      () =>
        new PostgresConnection({
          connectionString: url,
          migrate: true,
          skipMigrations: true,
        }),
    ).toThrow(/cannot both be enabled/);
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

  const resetRecommendedVersionWarning = () => {
    delete (assertPostgresVersion as any)._warnedRecommendedVersion;
  };

  beforeEach(resetRecommendedVersionWarning);
  afterEach(resetRecommendedVersionWarning);

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

describe('PostgreSQL read-only schema check', () => {
  it('uses one SELECT and accepts a newer same-major schema', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          version: LATEST_SCHEMA_VERSION + 1,
          min_client_version: BULLMQ_MAJOR_VERSION,
          server_version_num: '160000',
          server_version: '16.0',
        },
      ],
    });

    await expect(assertSchemaCompatibility({ query } as any)).resolves.toBe(
      LATEST_SCHEMA_VERSION + 1,
    );
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0]).toMatch(/^\s*SELECT\b/);
    expect(query.mock.calls[0][0]).not.toMatch(
      /\b(?:BEGIN|CREATE|ALTER|UPDATE|LOCK)\b/,
    );
  });

  it('rejects a schema requiring a newer BullMQ major', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            version: LATEST_SCHEMA_VERSION + 1,
            min_client_version: BULLMQ_MAJOR_VERSION + 1,
            server_version_num: '160000',
            server_version: '16.0',
          },
        ],
      }),
    };

    await expect(
      assertSchemaCompatibility(client as any),
    ).rejects.toBeInstanceOf(SchemaVersionMismatchError);
  });
});
