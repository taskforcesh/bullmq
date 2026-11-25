import { Pool } from 'pg';
import {
  createPostgresRelayBackend,
  createRedisRelayBackend,
  IRedisClient,
  IRelayBackend,
  Relay,
  RelayOptions,
} from '../../src';
import { createTestConnection } from './connection-factory';
import { getPostgresUrl } from '../postgres/utils/postgres-url';

/**
 * Backend-aware helpers for the relay tests. The tests themselves are
 * backend-agnostic: they run against Redis (with every client adapter, through
 * the usual configs) and against PostgreSQL when `BULLMQ_TEST_BACKEND` is
 * `postgres` (see vitest.postgres.config.ts). Only this file knows how each
 * backend stores its data.
 */
export type RelayTestBackend = 'redis' | 'postgres';

export const relayTestBackend: RelayTestBackend =
  process.env.BULLMQ_TEST_BACKEND === 'postgres' ? 'postgres' : 'redis';

export interface RelayTestHarness {
  readonly backend: RelayTestBackend;
  /** Call in `beforeAll`. */
  setup(): Promise<void>;
  /** Call in `afterAll`. */
  teardown(): Promise<void>;
  createRelay(
    opts: Partial<RelayOptions<any>> & { namespace: string },
  ): Relay<any>;
  createBackend(namespace: string): IRelayBackend;
  /** Number of stored subscriptions in a namespace (to check cleanup). */
  countSubscriptions(namespace: string): Promise<number>;
  /**
   * What the datastore still holds for a namespace: Redis keys, or PostgreSQL
   * rows as `table:key`.
   */
  leftovers(namespace: string): Promise<string[]>;
  /**
   * Whether the datastore expires a namespace on its own (Redis), rather than
   * through the sweeps of other nodes (PostgreSQL).
   */
  readonly selfExpiring: boolean;
  /** Removes whatever a test left in the datastore for a namespace. */
  cleanup(namespace: string): Promise<void>;
}

/**
 * @param name - Distinguishes the PostgreSQL schema of each test file, so
 * files can run in parallel.
 */
export function relayTestHarness(name: string): RelayTestHarness {
  return relayTestBackend === 'postgres'
    ? postgresHarness(`bullmq_relay_${name}_test`)
    : redisHarness();
}

function redisHarness(): RelayTestHarness {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let connection: IRedisClient;

  const scanKeys = async (match: string): Promise<string[]> => {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await connection.scan(cursor, {
        MATCH: match,
        COUNT: 1000,
      });
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  };

  const baseKey = (namespace: string) => `${prefix}::relay:{${namespace}}`;

  return {
    backend: 'redis',
    selfExpiring: true,
    async setup() {
      connection = createTestConnection();
    },
    async teardown() {
      await connection.quit();
    },
    createRelay: opts => new Relay({ connection, prefix, ...opts }),
    createBackend: namespace =>
      createRedisRelayBackend({ connection, namespace, prefix }),
    async countSubscriptions(namespace) {
      const members = await connection.zrange(
        `${baseKey(namespace)}:subs`,
        0,
        -1,
      );
      return members.filter(member => member.startsWith('n|')).length;
    },
    async leftovers(namespace) {
      return (await scanKeys(`${baseKey(namespace)}:*`)).sort();
    },
    async cleanup(namespace) {
      const keys = await scanKeys(`${baseKey(namespace)}:*`);
      if (keys.length > 0) {
        await connection.del(...keys);
      }
    },
  };
}

function postgresHarness(schema: string): RelayTestHarness {
  let pool: Pool;
  const connection = () => ({
    connectionString: getPostgresUrl(),
    schema,
    migrate: true,
  });

  return {
    backend: 'postgres',
    selfExpiring: false,
    async setup() {
      pool = new Pool({ connectionString: getPostgresUrl() });
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    },
    async teardown() {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    },
    createRelay: opts =>
      new Relay({
        connection: connection(),
        backend: createPostgresRelayBackend,
        ...opts,
      }),
    createBackend: namespace =>
      createPostgresRelayBackend({ connection: connection(), namespace }),
    async countSubscriptions(namespace) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM "${schema}".relay_subscription WHERE ns = $1`,
        [namespace],
      );
      return rows[0].n;
    },
    async leftovers(namespace) {
      const { rows } = await pool.query(
        `SELECT 'relay_node:' || node_id AS row FROM "${schema}".relay_node WHERE ns = $1
         UNION ALL
         SELECT 'relay_subscription:' || node_id || '/' || endpoint_id || '/' || pattern
           FROM "${schema}".relay_subscription WHERE ns = $1
         UNION ALL
         SELECT 'relay_inbox:' || id FROM "${schema}".relay_inbox WHERE ns = $1
         UNION ALL
         SELECT 'relay_retained:' || topic FROM "${schema}".relay_retained WHERE ns = $1`,
        [namespace],
      );
      return rows.map(row => row.row).sort();
    },
    async cleanup(namespace) {
      // Subscriptions and inbox rows cascade from the node rows.
      await pool.query(`DELETE FROM "${schema}".relay_node WHERE ns = $1`, [
        namespace,
      ]);
      await pool.query(`DELETE FROM "${schema}".relay_retained WHERE ns = $1`, [
        namespace,
      ]);
    },
  };
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeout = 3000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeout) {
      throw new Error('waitFor timed out');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
