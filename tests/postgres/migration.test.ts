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
import { MIGRATIONS } from '../../src/postgres/migrations';
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

  it('supports deprecated skipMigrations: false as migrate-on-connect', async () => {
    const connection = new PostgresConnection({
      connectionString: url,
      skipMigrations: false,
    });
    try {
      await connection.waitUntilReady();
      const { rows } = await pool.query<{ version: number }>(
        `SELECT COALESCE(MAX(version), 0)::int AS version FROM "${schema}".migration`,
      );
      expect(rows[0].version).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      await connection.close();
    }
  });

  it.each([2, 4, 5])(
    'upgrades a database already at schema version %i',
    async version => {
      // Simulate a database created by a previous release: apply only the
      // migrations up to that version and record them in the ledger by hand.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
        await client.query(`SET LOCAL search_path TO "${schema}"`);
        await client.query(
          `CREATE TABLE IF NOT EXISTS migration (
           version integer PRIMARY KEY,
           name text NOT NULL,
           min_client_version integer NOT NULL,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
        );
        for (const migration of MIGRATIONS.filter(m => m.version <= version)) {
          await client.query(migration.load());
          await client.query(
            `INSERT INTO migration (version, name, min_client_version)
           VALUES ($1, $2, $3)`,
            [migration.version, migration.name, migration.minClientVersion],
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      const { rows: beforeRows } = await pool.query<{ version: number }>(
        `SELECT COALESCE(MAX(version), 0)::int AS version FROM "${schema}".migration`,
      );
      expect(beforeRows[0].version).toBe(version);

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

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SET LOCAL search_path TO "${schema}"`);
          await client.query(
            `INSERT INTO relay_node (ns, node_id, lease_until)
           VALUES ('upgrade', 'expired', clock_timestamp() - interval '1 second'),
                  ('upgrade', 'live', clock_timestamp() + interval '1 minute')`,
          );
          const { rows } = await client.query(
            `SELECT relay_heartbeat('upgrade', 'expired', 30000) AS expired,
                  relay_heartbeat('upgrade', 'live', 30000) AS live`,
          );
          expect(rows[0]).toEqual({ expired: false, live: true });
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }

        // The pending migrations really ran against the existing schema: a
        // deduplication key whose winner job is gone is now recovered instead of
        // swallowing every subsequent add.
        await pool.query(
          `INSERT INTO "${schema}".dedup (queue, dedup_id, job_id, expire_at_ms)
         VALUES ('upgraded', 'dedup-id', 'gone', NULL)`,
        );
        const { rows: dedupRows } = await pool.query<{ winner: string | null }>(
          `SELECT "${schema}".deduplicate_job(
           'upgraded', '{"id":"dedup-id"}'::jsonb, 'new-job', $1, 'test',
           '{}'::jsonb, '{}'::jsonb) AS winner`,
          [Date.now()],
        );
        expect(dedupRows[0].winner).toBeNull();

        const { rows: keyRows } = await pool.query<{ job_id: string }>(
          `SELECT job_id FROM "${schema}".dedup
          WHERE queue = 'upgraded' AND dedup_id = 'dedup-id'`,
        );
        expect(keyRows[0].job_id).toBe('new-job');
      } finally {
        await connection.close();
      }
    },
  );

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

    await pool.query(
      `UPDATE "${schema}".migration
          SET min_client_version = $1
        WHERE version = $2`,
      [BULLMQ_MAJOR_VERSION + 1, futureVersion],
    );
    const incompatible = new PostgresConnection({ connectionString: url });

    try {
      await expect(incompatible.waitUntilReady()).rejects.toBeInstanceOf(
        SchemaVersionMismatchError,
      );
    } finally {
      await incompatible.close();
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

/**
 * A migration may keep `minClientVersion` at the current major only if
 * applying it does not break instances still running the previous library
 * code: they keep working and simply lack the new features. The relay
 * migration claims this by only adding new `relay_*` objects; this test
 * proves it by comparing every pre-existing object before and after.
 */
describe('PostgreSQL relay migration (0004_relay)', () => {
  const url = getPostgresUrl();
  const before = 'bullmq_pre_relay_test';
  const after = 'bullmq_post_relay_test';
  let pool: Pool;

  /** Every object of a schema, as normalized definition strings. */
  const snapshot = async (schema: string): Promise<string[]> => {
    const { rows } = await pool.query<{ item: string }>(
      `SELECT 'column ' || c.table_name || '.' || c.column_name || ' ' || c.data_type
              || ' default=' || COALESCE(c.column_default, '') || ' null=' || c.is_nullable AS item
         FROM information_schema.columns c WHERE c.table_schema = $1
       UNION ALL
       SELECT 'index ' || indexname || ' ' || indexdef
         FROM pg_indexes WHERE schemaname = $1
       UNION ALL
       SELECT 'constraint ' || cl.relname || ' ' || con.conname || ' ' || pg_get_constraintdef(con.oid)
         FROM pg_constraint con
         JOIN pg_class cl ON cl.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE n.nspname = $1
       UNION ALL
       SELECT 'function ' || p.proname || ' ' || pg_get_functiondef(p.oid)
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')
       UNION ALL
       SELECT 'type ' || t.typname || ' ' || t.typtype::text || ' ' || COALESCE(
                (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
                   FROM pg_enum e WHERE e.enumtypid = t.oid), '')
         FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = $1 AND t.typtype IN ('e', 'd', 'c')
       UNION ALL
       SELECT 'sequence ' || sequence_name
         FROM information_schema.sequences WHERE sequence_schema = $1
       UNION ALL
       SELECT 'trigger ' || tg.tgname || ' ' || pg_get_triggerdef(tg.oid)
         FROM pg_trigger tg
         JOIN pg_class cl ON cl.oid = tg.tgrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE n.nspname = $1 AND NOT tg.tgisinternal`,
      [schema],
    );
    return rows.map(row => row.item.split(schema).join('<schema>')).sort();
  };

  /** Applies the migrations before the relay one, as an older release did. */
  const migrateBeforeRelay = async (schema: string) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      for (const migration of MIGRATIONS.filter(m => m.name < '0004_relay')) {
        await client.query(migration.load());
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    for (const schema of [before, after]) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });

  afterAll(async () => {
    for (const schema of [before, after]) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await pool.end();
  });

  it('is marked compatible with the current major', () => {
    const relay = MIGRATIONS.find(m => m.name === '0004_relay');
    expect(relay?.minClientVersion).toBe(BULLMQ_MAJOR_VERSION);
  });

  it('leaves every pre-existing object unchanged and only adds relay_* objects', async () => {
    await migrateBeforeRelay(before);
    const client = await pool.connect();
    try {
      await runMigrations(client, after);
    } finally {
      client.release();
    }

    // The migration ledger is not part of the hand-applied schema.
    const isLedger = (item: string) =>
      /^(column migration\.|index migration_pkey |constraint migration |type migration )/.test(
        item,
      );
    const pre = (await snapshot(before)).filter(item => !isLedger(item));
    const post = (await snapshot(after)).filter(item => !isLedger(item));

    // Nothing that existed before was altered, replaced or removed.
    const postSet = new Set(post);
    expect(pre.filter(item => !postSet.has(item))).toEqual([]);

    // Everything added belongs to the relay.
    const preSet = new Set(pre);
    const added = post.filter(item => !preSet.has(item));
    expect(added.length).toBeGreaterThan(0);
    const foreign = added.filter(
      item =>
        !/^(column|index|constraint|function|type|sequence|trigger) relay_/.test(
          item,
        ),
    );
    expect(foreign).toEqual([]);
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

describe('PostgreSQL compatibility aliases and options', () => {
  it('keeps legacy SchemaVersionMismatchError fields as aliases', () => {
    const err = new SchemaVersionMismatchError(9, 8);
    expect(err.minimumClientVersion).toBe(9);
    expect(err.clientVersion).toBe(8);
    expect(err.databaseVersion).toBe(9);
    expect(err.supportedVersion).toBe(8);
  });

  it('rejects migrate and skipMigrations used together', () => {
    expect(
      () =>
        new PostgresConnection({
          connectionString: 'postgres://localhost:5432/mydb',
          migrate: true,
          skipMigrations: true,
        }),
    ).toThrow(/mutually exclusive/i);
  });
});
