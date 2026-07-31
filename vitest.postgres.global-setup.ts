/**
 * Global setup for the PostgreSQL shared-suite run.
 *
 * Drops the BullMQ schema once before the whole test run so the migrations
 * re-apply from scratch on the first backend connection. This keeps the schema
 * in sync while the migrations are still being developed (they are edited in
 * place rather than appended), and removes the need to manually
 * `DROP SCHEMA … CASCADE` before every run.
 *
 * Runs once per `vitest run` (in the main process), unlike `setupFiles` which
 * runs per test file.
 */
import { Pool } from 'pg';
import { DEFAULT_SCHEMA } from './src/postgres';
import { getPostgresUrl } from './tests/postgres/utils/postgres-url';

export default async function (): Promise<void> {
  const pool = new Pool({ connectionString: getPostgresUrl() });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${DEFAULT_SCHEMA}" CASCADE`);
  } finally {
    await pool.end();
  }
}
