import { loadMigrationSql } from '../sql-loader';

/**
 * A single, ordered schema migration. The `.sql` file is the source of truth;
 * `version` is the monotonically increasing schema version recorded in the
 * `bullmq_migration` ledger table once applied.
 */
export interface Migration {
  /** Monotonically increasing schema version (1, 2, 3, …). */
  version: number;
  /** Human-readable name (matches the `.sql` filename without extension). */
  name: string;
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
    name: '0001_init',
    load: () => loadMigrationSql('0001_init.sql'),
  },
  {
    version: 2,
    name: '0002_core_schema',
    load: () => loadMigrationSql('0002_core_schema.sql'),
  },
  {
    version: 3,
    name: '0003_operations',
    load: () => loadMigrationSql('0003_operations.sql'),
  },
  {
    version: 4,
    name: '0004_retry',
    load: () => loadMigrationSql('0004_retry.sql'),
  },
  {
    version: 5,
    name: '0005_retention',
    load: () => loadMigrationSql('0005_retention.sql'),
  },
  {
    version: 6,
    name: '0006_events',
    load: () => loadMigrationSql('0006_events.sql'),
  },
  {
    version: 7,
    name: '0007_admin',
    load: () => loadMigrationSql('0007_admin.sql'),
  },
  {
    version: 8,
    name: '0008_flows',
    load: () => loadMigrationSql('0008_flows.sql'),
  },
  {
    version: 9,
    name: '0009_job_mutations',
    load: () => loadMigrationSql('0009_job_mutations.sql'),
  },
  {
    version: 10,
    name: '0010_finish_semantics',
    load: () => loadMigrationSql('0010_finish_semantics.sql'),
  },
  {
    version: 11,
    name: '0011_progress_retry_wait',
    load: () => loadMigrationSql('0011_progress_retry_wait.sql'),
  },
  {
    version: 12,
    name: '0012_add_job_parent',
    load: () => loadMigrationSql('0012_add_job_parent.sql'),
  },
  {
    version: 13,
    name: '0013_reprocess_worker_name',
    load: () => loadMigrationSql('0013_reprocess_worker_name.sql'),
  },
  {
    version: 14,
    name: '0014_retention_boundary',
    load: () => loadMigrationSql('0014_retention_boundary.sql'),
  },
  {
    version: 15,
    name: '0015_promote_clear_delay',
    load: () => loadMigrationSql('0015_promote_clear_delay.sql'),
  },
  {
    version: 16,
    name: '0016_reprocess_clear_processed',
    load: () => loadMigrationSql('0016_reprocess_clear_processed.sql'),
  },
  {
    version: 17,
    name: '0017_retries_exhausted',
    load: () => loadMigrationSql('0017_retries_exhausted.sql'),
  },
  {
    version: 18,
    name: '0018_retry_waiting_prev',
    load: () => loadMigrationSql('0018_retry_waiting_prev.sql'),
  },
  {
    version: 19,
    name: '0019_step_jobs',
    load: () => loadMigrationSql('0019_step_jobs.sql'),
  },
  {
    version: 20,
    name: '0020_clean',
    load: () => loadMigrationSql('0020_clean.sql'),
  },
  {
    version: 21,
    name: '0021_job_scheduler',
    load: () => loadMigrationSql('0021_job_scheduler.sql'),
  },
  {
    version: 22,
    name: '0022_scheduler_protection',
    load: () => loadMigrationSql('0022_scheduler_protection.sql'),
  },
  {
    version: 23,
    name: '0023_waiting_event_on_promote',
    load: () => loadMigrationSql('0023_waiting_event_on_promote.sql'),
  },
  {
    version: 24,
    name: '0024_stalled_two_phase',
    load: () => loadMigrationSql('0024_stalled_two_phase.sql'),
  },
  {
    version: 25,
    name: '0025_rate_limit',
    load: () => loadMigrationSql('0025_rate_limit.sql'),
  },
  {
    version: 26,
    name: '0026_active_to_wait_priority',
    load: () => loadMigrationSql('0026_active_to_wait_priority.sql'),
  },
  {
    version: 27,
    name: '0027_obliterate',
    load: () => loadMigrationSql('0027_obliterate.sql'),
  },
  {
    version: 28,
    name: '0028_deduplication',
    load: () => loadMigrationSql('0028_deduplication.sql'),
  },
  {
    version: 29,
    name: '0029_flow_failure',
    load: () => loadMigrationSql('0029_flow_failure.sql'),
  },
];

/**
 * The highest schema version this BullMQ build knows how to produce. Compared
 * against the version recorded in the database to decide whether to migrate
 * (database older), no-op (equal), or refuse to run (database newer).
 */
export const LATEST_SCHEMA_VERSION: number =
  MIGRATIONS.length > 0 ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
