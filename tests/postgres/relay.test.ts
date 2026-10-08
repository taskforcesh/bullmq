import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
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

describe('Relay (postgres) concurrency', () => {
  it('a publish racing with a sweep of one of its nodes still succeeds', async () => {
    const namespace = `t-${randomUUID().slice(0, 13)}`;
    const backend = createPostgresRelayBackend({
      connection: connection(),
      namespace,
    });
    await backend.waitUntilReady();
    await backend.registerNode('n1', 30_000);
    await backend.registerNode('n2', 30_000);
    await backend.subscribe('n1', 'e1', 'a');
    await backend.subscribe('n2', 'e2', 'a');

    // Another node is sweeping n1: its delete is not committed yet.
    const sweeper = await pool.connect();
    try {
      await sweeper.query('BEGIN');
      await sweeper.query(
        `DELETE FROM "${schema}".relay_node WHERE ns = $1 AND node_id = 'n1'`,
        [namespace],
      );
      const publishing = backend.publish('a', '1', {
        ts: 1,
        retainMs: 0,
        maxSize: 10,
      });
      await new Promise(resolve => setTimeout(resolve, 200));
      await sweeper.query('COMMIT');

      await expect(publishing).resolves.toMatchObject({
        nodes: 1,
        endpoints: 1,
      });
    } finally {
      sweeper.release();
      await backend.close();
      await pool.query(`DELETE FROM "${schema}".relay_node WHERE ns = $1`, [
        namespace,
      ]);
    }
  });
});
