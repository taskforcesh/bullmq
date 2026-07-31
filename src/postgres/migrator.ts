import { LATEST_SCHEMA_VERSION, Migration, MIGRATIONS } from './migrations';
import { PgQueryable } from './pg-types';

/**
 * Default PostgreSQL schema (namespace) the backend lives in. The schema is the
 * connection-level namespace for *all* queues — the SQL-native replacement for
 * Redis's per-queue key `prefix`.
 */
export const DEFAULT_SCHEMA = 'bullmq';

/**
 * Stable key for the transaction-scoped advisory lock that serializes
 * migrations across processes. The integer spells `BULL` (0x42554c4c) and is
 * documented here so other runtimes (the Elixir/Python ports) use the exact
 * same lock. The lock is namespaced per schema (via `hashtext(schema)`) so
 * migrating one namespace never blocks another.
 */
export const MIGRATION_ADVISORY_LOCK_KEY = 0x42554c4c; // 1112493644

/**
 * Lowest PostgreSQL *major* version the backend supports. Below this the schema
 * and operation functions rely on features (or fixes) that are absent or
 * unreliable, so we refuse to run rather than fail later in a surprising way.
 *
 * Rationale: the operation functions use `INSERT … ON CONFLICT`, transaction
 * advisory locks, `to_regclass`, multi-array `unnest(…) WITH ORDINALITY`, and
 * lean on the read-write "expanded array" representation for cheap in-loop
 * accumulation — all comfortably available here, on a version that is still
 * within the PostgreSQL support window.
 */
export const MINIMUM_POSTGRES_VERSION = 13;

/**
 * Recommended lowest PostgreSQL *major* version. Between {@link
 * MINIMUM_POSTGRES_VERSION} and this we still run, but emit a one-time warning
 * (mirrors the Redis backend's `recommendedMinimumVersion`).
 */
export const RECOMMENDED_POSTGRES_VERSION = 14;

/**
 * Thrown when the connected PostgreSQL server is older than {@link
 * MINIMUM_POSTGRES_VERSION}. Pass `skipVersionCheck: true` on the connection to
 * bypass the check (at your own risk).
 */
export class UnsupportedPostgresVersionError extends Error {
  constructor(
    public readonly serverVersion: string,
    public readonly minimumVersion: number,
  ) {
    super(
      `BullMQ: the PostgreSQL backend requires server version ` +
        `${minimumVersion} or newer, but the server reports ${serverVersion}. ` +
        `Upgrade PostgreSQL, or pass \`skipVersionCheck: true\` on the ` +
        `connection to bypass this check at your own risk.`,
    );
    this.name = 'UnsupportedPostgresVersionError';
  }
}

/**
 * Verifies the connected server meets {@link MINIMUM_POSTGRES_VERSION} (throws
 * an {@link UnsupportedPostgresVersionError} otherwise) and warns once when it
 * is below {@link RECOMMENDED_POSTGRES_VERSION}. No-op when `skipVersionCheck`
 * is set. Uses `server_version_num` (e.g. `160002` for 16.2), whose integer
 * major component is `num / 10000` for every supported release.
 */
export async function assertPostgresVersion(
  client: PgQueryable,
  skipVersionCheck = false,
): Promise<void> {
  if (skipVersionCheck) {
    return;
  }
  const { rows } = await client.query<{ num: string; ver: string }>(
    `SELECT current_setting('server_version_num') AS num, ` +
      `current_setting('server_version') AS ver`,
  );
  const major = Math.floor(parseInt(rows[0]?.num ?? '0', 10) / 10000);
  const reported = rows[0]?.ver ?? 'unknown';
  if (major < MINIMUM_POSTGRES_VERSION) {
    throw new UnsupportedPostgresVersionError(
      reported,
      MINIMUM_POSTGRES_VERSION,
    );
  }
  if (major < RECOMMENDED_POSTGRES_VERSION) {
    const warned = (assertPostgresVersion as any)._warnedRecommendedVersion;
    if (!warned) {
      (assertPostgresVersion as any)._warnedRecommendedVersion = true;
      console.warn(
        `BullMQ: PostgreSQL ${RECOMMENDED_POSTGRES_VERSION} or newer is ` +
          `recommended for the PostgreSQL backend (detected ${reported}).`,
      );
    }
  }
}

/**
 * Validates a PostgreSQL schema name and returns it double-quoted for safe
 * interpolation into DDL (schema names cannot be passed as bind parameters).
 *
 * Only simple identifiers are allowed (letter/underscore start, then
 * letters/digits/underscores/`$`, max 63 bytes), which both keeps the value
 * injection-safe and avoids surprising case-folding / quoting edge cases.
 */
export function quoteSchemaName(schema: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(schema) || schema.length > 63) {
    throw new Error(
      `BullMQ: invalid PostgreSQL schema name ${JSON.stringify(schema)}. ` +
        'Use a simple identifier (letters, digits, underscores; max 63 chars).',
    );
  }
  return `"${schema}"`;
}

/**
 * Thrown when the database schema is newer than this BullMQ build supports.
 *
 * This happens when the schema was migrated by a newer BullMQ release and an
 * older instance then connects: the older code may not understand the newer
 * structures, so we refuse to operate rather than risk corruption. The fix is
 * to upgrade BullMQ — schema downgrades are not supported.
 */
export class SchemaVersionMismatchError extends Error {
  constructor(
    public readonly databaseVersion: number,
    public readonly supportedVersion: number,
  ) {
    super(
      `BullMQ: the PostgreSQL schema is at version ${databaseVersion}, but this ` +
        `version of BullMQ only supports schema versions up to ${supportedVersion}. ` +
        `The database was migrated by a newer BullMQ release; upgrade BullMQ to ` +
        `continue (schema downgrades are not supported).`,
    );
    this.name = 'SchemaVersionMismatchError';
  }
}

/**
 * Brings the database schema up to {@link LATEST_SCHEMA_VERSION}.
 *
 * Run on the backend's first `waitUntilReady()` (a constructor cannot perform
 * async I/O). Behaviour by current database version:
 *
 * - **older** than supported → applies the pending migrations in order.
 * - **equal** to supported → no-op.
 * - **newer** than supported → throws {@link SchemaVersionMismatchError}.
 *
 * ## Atomicity
 *
 * The whole operation runs inside a **single transaction**: every pending
 * migration's SQL and its ledger row are committed together, or nothing is. If
 * any migration fails the transaction is rolled back and the database is left
 * exactly at its previous schema version — there are no partially-applied
 * upgrades.
 *
 * For this guarantee to hold, migration `.sql` files must contain only
 * transaction-safe statements. PostgreSQL DDL (`CREATE TABLE`/`FUNCTION`/`INDEX`,
 * `ALTER …`, …) is transactional, but a few commands are not and must never be
 * used in a migration: `CREATE INDEX CONCURRENTLY`, `VACUUM`, `CREATE DATABASE`,
 * etc.
 *
 * ## Isolation
 *
 * A transaction-scoped `pg_advisory_xact_lock` serializes concurrent starters
 * (many Queue/Worker instances booting at once across processes), so the
 * migrations run exactly once. The lock is acquired as the first statement and
 * released automatically when the transaction commits or rolls back (or if the
 * connection dies), so it can never leak. Late starters block until the winner
 * commits, then observe the up-to-date version and no-op.
 *
 * ## Namespace
 *
 * All objects are created in `schema` (default {@link DEFAULT_SCHEMA}), the
 * connection-level namespace that replaces Redis's per-queue key prefix. The
 * schema is created if missing and `search_path` is set (transaction-locally)
 * so the migrations' unqualified table names resolve into it.
 *
 * The caller MUST provide a single dedicated session (e.g. a checked-out
 * `pg.PoolClient` or a standalone `pg.Client`), never the pool itself, so the
 * lock and the transaction share one connection.
 *
 * @returns the schema version the database is at after the call.
 */
export async function runMigrations(
  client: PgQueryable,
  schema: string = DEFAULT_SCHEMA,
  options: { skipVersionCheck?: boolean } = {},
): Promise<number> {
  const quotedSchema = quoteSchemaName(schema);

  // Fail fast on an unsupported server *before* opening the migration
  // transaction, so an old server surfaces a clear error rather than a cryptic
  // syntax/feature failure partway through applying DDL.
  await assertPostgresVersion(client, options.skipVersionCheck);

  await client.query('BEGIN');
  try {
    // Isolation: serialize concurrent migrators for THIS schema. The lock is
    // held for the lifetime of this transaction and released automatically on
    // COMMIT/ROLLBACK. Namespaced by schema so different namespaces don't block.
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      MIGRATION_ADVISORY_LOCK_KEY,
      schema,
    ]);

    // Create the namespace and point unqualified names at it for the rest of
    // the transaction (SET LOCAL is reverted on COMMIT/ROLLBACK).
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
    await client.query(`SET LOCAL search_path TO ${quotedSchema}`);

    await ensureLedgerTable(client);
    const currentVersion = await getCurrentSchemaVersion(client);

    if (currentVersion > LATEST_SCHEMA_VERSION) {
      // Rolled back by the catch below; nothing has been written anyway.
      throw new SchemaVersionMismatchError(
        currentVersion,
        LATEST_SCHEMA_VERSION,
      );
    }

    if (currentVersion < LATEST_SCHEMA_VERSION) {
      for (const migration of MIGRATIONS) {
        if (migration.version > currentVersion) {
          await applyMigration(client, migration);
        }
      }
    }

    // Atomicity: every migration applied above and its ledger row commit
    // together as one unit.
    await client.query('COMMIT');

    return Math.max(currentVersion, LATEST_SCHEMA_VERSION);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * Reads the schema version currently recorded in the database, or 0 for a fresh
 * database. Assumes the ledger table already exists (see
 * {@link ensureLedgerTable}).
 */
export async function getCurrentSchemaVersion(
  client: PgQueryable,
): Promise<number> {
  const { rows } = await client.query<{ version: number }>(
    'SELECT COALESCE(MAX(version), 0)::int AS version FROM bullmq_migration',
  );
  return rows[0]?.version ?? 0;
}

async function ensureLedgerTable(client: PgQueryable): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS bullmq_migration (
       version    integer PRIMARY KEY,
       name       text NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
}

async function applyMigration(
  client: PgQueryable,
  migration: Migration,
): Promise<void> {
  await client.query(migration.load());
  await client.query(
    'INSERT INTO bullmq_migration (version, name) VALUES ($1, $2)',
    [migration.version, migration.name],
  );
}
