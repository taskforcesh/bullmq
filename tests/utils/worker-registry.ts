import { Pool } from 'pg';
import {
  createPostgresBackend,
  createRedisBackend,
  IQueueBackend,
  IRedisClient,
} from '../../src';
import { createTestConnection } from './connection-factory';
import { getPostgresUrl } from '../postgres/utils/postgres-url';

/**
 * Backend-aware helpers for the worker registry tests. The tests themselves
 * are backend-agnostic: they run against Redis (with every client adapter,
 * through the usual configs) and against PostgreSQL when
 * `BULLMQ_TEST_BACKEND` is `postgres` (see vitest.postgres.config.ts). Only
 * this file knows how each backend stores its data.
 */
export type WorkerRegistryTestBackend = 'redis' | 'postgres';

export const workerRegistryTestBackend: WorkerRegistryTestBackend =
  process.env.BULLMQ_TEST_BACKEND === 'postgres' ? 'postgres' : 'redis';

export interface WorkerRegistryTestHarness {
  readonly backend: WorkerRegistryTestBackend;
  /** Call in `beforeAll`. */
  setup(): Promise<void>;
  /** Call in `afterAll`. */
  teardown(): Promise<void>;
  createBackend(queueName: string): IQueueBackend;
  /**
   * What the datastore still holds for a queue's registry: Redis keys, or
   * PostgreSQL rows as `table:key`.
   */
  leftovers(queueName: string): Promise<string[]>;
  /**
   * Whether the datastore expires a queue's registry on its own (Redis),
   * rather than through sweeps (PostgreSQL).
   */
  readonly selfExpiring: boolean;
  /** Removes whatever a test left in the datastore for a queue. */
  cleanup(queueName: string): Promise<void>;
}

/**
 * @param name - Distinguishes the PostgreSQL schema of each test file, so
 * files can run in parallel.
 */
export function workerRegistryTestHarness(
  name: string,
): WorkerRegistryTestHarness {
  return workerRegistryTestBackend === 'postgres'
    ? postgresHarness(`bullmq_worker_registry_${name}_test`)
    : redisHarness();
}

function redisHarness(): WorkerRegistryTestHarness {
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

  const baseKey = (queueName: string) => `${prefix}:${queueName}:workers`;

  return {
    backend: 'redis',
    selfExpiring: true,
    async setup() {
      connection = createTestConnection();
    },
    async teardown() {
      await connection.quit();
    },
    createBackend: queueName => {
      // Passed as a variable, like tests/create-backend.test.ts: `prefix` is a
      // KeyPrefixOptions field, not part of QueueBaseOptions.
      const opts = { connection, prefix };
      return createRedisBackend(queueName, opts);
    },
    async leftovers(queueName) {
      return (await scanKeys(`${baseKey(queueName)}:*`)).sort();
    },
    async cleanup(queueName) {
      const keys = await scanKeys(`${baseKey(queueName)}:*`);
      if (keys.length > 0) {
        await connection.del(...keys);
      }
    },
  };
}

function postgresHarness(schema: string): WorkerRegistryTestHarness {
  let pool: Pool;

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
    createBackend: queueName =>
      createPostgresBackend(queueName, {
        connection: {
          connectionString: getPostgresUrl(),
          schema,
          migrate: true,
        },
      }),
    async leftovers(queueName) {
      const { rows } = await pool.query(
        `SELECT 'worker_registration:' || worker_id AS row
           FROM "${schema}".worker_registration WHERE queue = $1`,
        [queueName],
      );
      return rows.map(row => row.row).sort();
    },
    async cleanup(queueName) {
      await pool.query(
        `DELETE FROM "${schema}".worker_registration WHERE queue = $1`,
        [queueName],
      );
    },
  };
}
