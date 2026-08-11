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
  /** Oldest BullMQ major version that can use the schema after this migration. */
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
    // This initial schema split is the sole same-major exception. Future schema
    // migrations are breaking changes and require a new BullMQ major version.
    minClientVersion: 6,
    load: () => loadMigrationSql('0002_functions.sql'),
  },
];

/**
 * The highest schema version this BullMQ build knows how to produce. Explicit
 * migration applies older pending versions.
 */
export const LATEST_SCHEMA_VERSION: number =
  MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
