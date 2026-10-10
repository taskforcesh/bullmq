import { loadMigrationSql } from '../sql-loader';

/**
 * A single, ordered schema migration. The `.sql` file is the source of truth;
 * `version` is the monotonically increasing schema version recorded in the
 * `migration` ledger table once applied.
 */
export interface Migration {
  /** Monotonically increasing schema version (1, 2, 3, …). */
  version: number;
  /** Human-readable name (matches the `.sql` filename without extension). */
  name: string;
  /**
   * Oldest BullMQ major version that can use the schema after this migration.
   *
   * Keep it at the current major when applying the migration does not break
   * instances still running the previous library code: they keep working
   * normally and simply don't get the new features (e.g. new tables or new
   * functions only, or function-body fixes with identical signatures and
   * behaviour). Raise it, in a new BullMQ major, when existing code would
   * break (e.g. dropped or renamed objects, changed signatures, changed
   * semantics of functions old clients call).
   */
  minClientVersion: number;
  /** Loads this migration's SQL from its `.sql` file. */
  load(): string;
}

/**
 * The ordered list of migrations bundled with this version of BullMQ. Append a
 * new entry (never edit or reorder existing ones) whenever the schema changes.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: '0001_schema',
    minClientVersion: 6,
    load: () => loadMigrationSql('0001_schema.sql'),
  },
  {
    version: 2,
    name: '0002_functions',
    minClientVersion: 6,
    load: () => loadMigrationSql('0002_functions.sql'),
  },
  {
    version: 3,
    name: '0003_dedup_stale_key',
    // Function-body fix only (CREATE OR REPLACE, identical signature, no DDL),
    // so clients from the same major keep working against the updated schema.
    minClientVersion: 6,
    load: () => loadMigrationSql('0003_dedup_stale_key.sql'),
  },
  {
    version: 4,
    name: '0004_relay',
    // Additive only (new relay_* tables, sequence and functions; no change to
    // existing objects), so instances on the previous code keep working.
    // Verified by the "relay migration" test in tests/postgres/migration.test.ts.
    minClientVersion: 6,
    load: () => loadMigrationSql('0004_relay.sql'),
  },
  {
    version: 5,
    name: '0005_relay_expired_lease',
    minClientVersion: 6,
    load: () => loadMigrationSql('0005_relay_expired_lease.sql'),
  },
  {
    version: 6,
    name: '0006_relay_retained',
    minClientVersion: 6,
    load: () => loadMigrationSql('0006_relay_retained.sql'),
  },
];

/**
 * The highest schema version this BullMQ build knows how to produce. Explicit
 * migration applies older pending versions.
 */
export const LATEST_SCHEMA_VERSION: number =
  MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
