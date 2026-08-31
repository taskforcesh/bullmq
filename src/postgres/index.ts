export { createPostgresBackend } from './create-postgres-backend';
export {
  PostgresConnection,
  type PostgresConnectionOptions,
  type PostgresPoolConfig,
} from './postgres-connection';
export { PostgresQueueBackend } from './postgres-queue-backend';
export {
  runMigrations,
  assertSchemaCompatibility,
  SchemaMigrationRequiredError,
  SchemaVersionMismatchError,
  UnsupportedPostgresVersionError,
  assertPostgresVersion,
  MINIMUM_POSTGRES_VERSION,
  RECOMMENDED_POSTGRES_VERSION,
  BULLMQ_MAJOR_VERSION,
  MIGRATION_ADVISORY_LOCK_KEY,
  DEFAULT_SCHEMA,
  quoteSchemaName,
} from './migrator';
export { LATEST_SCHEMA_VERSION } from './migrations';
export type {
  PgPool,
  PgPoolClient,
  PgPoolConfig,
  PgModule,
  PgQueryable,
  PgQueryResult,
  PgNotification,
} from './pg-types';

export { isPgPool } from './pg-types';
