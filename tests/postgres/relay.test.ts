import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
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
  it.each(['subscribe', 'publish'] as const)(
    'serializes retained delivery when %s commits first',
    async firstOperation => {
      const namespace = `t-${randomUUID().slice(0, 13)}`;
      const backend = createPostgresRelayBackend({
        connection: connection(),
        namespace,
      });
      await backend.waitUntilReady();
      await backend.registerNode('n1', 30_000);
      const first = await pool.connect();
      const second = await pool.connect();
      const run = (client: PoolClient, operation: 'subscribe' | 'publish') =>
        client.query(
          operation === 'subscribe'
            ? `SELECT * FROM relay_subscribe($1, 'n1', 'e1', 'a')`
            : `SELECT * FROM relay_publish($1, 'a', '"retained"', 1, 30000, 100)`,
          [namespace],
        );
      try {
        for (const client of [first, second]) {
          await client.query('BEGIN');
          await client.query(`SET LOCAL search_path TO "${schema}"`);
          await client.query(`SET LOCAL statement_timeout = '5s'`);
        }
        const { rows: pidRows } = await second.query(
          'SELECT pg_backend_pid() AS pid',
        );
        const firstResult = await run(first, firstOperation);
        const overlapping = run(
          second,
          firstOperation === 'subscribe' ? 'publish' : 'subscribe',
        );
        overlapping.catch(() => undefined);

        // Wait for the competing transaction to reach the topic lock rather
        // than relying on a sleep to arrange the race.
        await vi.waitFor(async () => {
          const { rows } = await pool.query(
            `SELECT count(*)::int AS n FROM pg_locks
             WHERE pid = $1 AND locktype = 'advisory' AND NOT granted`,
            [pidRows[0].pid],
          );
          expect(rows[0].n).toBe(1);
        });
        await first.query('COMMIT');
        const secondResult = await overlapping;
        await second.query('COMMIT');

        const subscription =
          firstOperation === 'subscribe' ? firstResult : secondResult;
        const publication =
          firstOperation === 'publish' ? firstResult : secondResult;
        expect(subscription.rows[0].added).toBe(true);
        const { rows: inbox } = await pool.query(
          `SELECT mid, data, endpoints FROM "${schema}".relay_inbox WHERE ns = $1`,
          [namespace],
        );
        if (firstOperation === 'subscribe') {
          expect(subscription.rows[0].retained_mid).toBeNull();
          expect(publication.rows[0].endpoint_count).toBe(1);
          expect(inbox).toEqual([
            {
              mid: publication.rows[0].message_id,
              data: '"retained"',
              endpoints: ['e1'],
            },
          ]);
        } else {
          expect(subscription.rows[0]).toMatchObject({
            retained_mid: publication.rows[0].message_id,
            retained_data: '"retained"',
          });
          expect(publication.rows[0].endpoint_count).toBe(0);
          expect(inbox).toEqual([]);
        }
      } finally {
        await first.query('ROLLBACK');
        await second.query('ROLLBACK');
        first.release();
        second.release();
        await backend.close();
        await pool.query(`DELETE FROM "${schema}".relay_node WHERE ns = $1`, [
          namespace,
        ]);
        await pool.query(
          `DELETE FROM "${schema}".relay_retained WHERE ns = $1`,
          [namespace],
        );
      }
    },
  );

  it('sweeps expired retained messages from an abandoned namespace in bounded batches', async () => {
    const namespace = `t-${randomUUID().slice(0, 13)}`;
    const abandoned = `${namespace}-old`;
    const publisher = createPostgresRelayBackend({
      connection: connection(),
      namespace: abandoned,
    });
    const sweeper = createPostgresRelayBackend({
      connection: connection(),
      namespace,
    });
    try {
      await publisher.waitUntilReady();
      await sweeper.waitUntilReady();
      await publisher.registerNode('n1', 30_000);
      for (const topic of ['expired1', 'expired2', 'live']) {
        await publisher.publish(topic, '1', {
          ts: 1,
          retainMs: 30_000,
          maxSize: 10,
        });
      }
      await publisher.unregisterNode('n1');
      await publisher.close();
      await pool.query(
        `UPDATE "${schema}".relay_retained
         SET expires_at = clock_timestamp() - interval '1 second'
         WHERE ns = $1 AND topic <> 'live'`,
        [abandoned],
      );

      await expect(sweeper.sweep(1)).resolves.toEqual([]);
      const { rows: remaining } = await pool.query(
        `SELECT topic FROM "${schema}".relay_retained WHERE ns = $1`,
        [abandoned],
      );
      expect(remaining).toHaveLength(2);
      expect(remaining).toContainEqual({ topic: 'live' });

      await expect(sweeper.sweep(1)).resolves.toEqual([]);
      const { rows } = await pool.query(
        `SELECT topic FROM "${schema}".relay_retained WHERE ns = $1`,
        [abandoned],
      );
      expect(rows).toEqual([{ topic: 'live' }]);
    } finally {
      await publisher.close();
      await sweeper.close();
      await pool.query(`DELETE FROM "${schema}".relay_node WHERE ns = $1`, [
        abandoned,
      ]);
      await pool.query(`DELETE FROM "${schema}".relay_retained WHERE ns = $1`, [
        abandoned,
      ]);
    }
  });

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
