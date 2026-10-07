import { afterAll, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { createPostgresRelayBackend, Relay } from '../../src';
import { describeRelay } from '../utils/relay-suite';
import { getPostgresUrl } from './utils/postgres-url';

const schema = 'bullmq_relay_test';
const connection = () => ({
  connectionString: getPostgresUrl(),
  schema,
  migrate: true,
});

let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: getPostgresUrl() });
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
});

describeRelay('postgres', {
  createBackend: namespace =>
    createPostgresRelayBackend({ connection: connection(), namespace }),
  createRelay: opts =>
    new Relay({
      connection: connection(),
      backend: createPostgresRelayBackend,
      ...opts,
    }),
  countSubscriptions: async namespace => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM "${schema}".relay_subscription WHERE ns = $1`,
      [namespace],
    );
    return rows[0].n;
  },
  cleanup: async namespace => {
    // Subscriptions and inbox rows cascade from the node rows.
    await pool.query(`DELETE FROM "${schema}".relay_node WHERE ns = $1`, [
      namespace,
    ]);
    await pool.query(`DELETE FROM "${schema}".relay_retained WHERE ns = $1`, [
      namespace,
    ]);
  },
});
