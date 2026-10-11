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

  return {
    backend: 'redis',
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
      let total = 0;
      for (const key of await scanKeys(
        `${prefix}:relay:${namespace}:sub:p:*`,
      )) {
        total += (await connection.smembers(key)).length;
      }
      return total;
    },
    async cleanup(namespace) {
      const keys = await scanKeys(`${prefix}:relay:${namespace}:*`);
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
