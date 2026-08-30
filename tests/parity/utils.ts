import { readFile } from 'node:fs/promises';
import {
  BackendFactory,
  createBunRedisClient,
  createPostgresBackend,
  createRedisBackend,
  PostgresQueueBackend,
  QueueOptions,
  RedisQueueBackend,
} from '../../src';

interface ParityBackend {
  factory: BackendFactory<PostgresQueueBackend | RedisQueueBackend>;
  options: QueueOptions;
}

export function getBackend(): ParityBackend {
  const port = parseInt(process.env.PARITY_BACKEND_PORT || '0');
  const backend = process.env.PARITY_BACKEND;

  if (backend === 'postgres') {
    return {
      factory: createPostgresBackend,
      options: {
        connection:
          `postgres://testuser:testpassword@localhost:${port}/testdb` as any as QueueOptions['connection'],
      },
    };
  }

  if (backend === 'redis') {
    return {
      factory: createRedisBackend,
      options: {
        connection: {
          port,
          host: 'localhost',
        },
      },
    };
  }

  throw new Error(`Invalid PARITY_BACKEND value ${typeof backend}(${backend})`);
}

export function logEvent(event_type: string, data?: any) {
  const run_id = process.env.PARITY_RUN_ID;
  console.log(JSON.stringify({ type: event_type, run_id, data }));
}

export async function readDefinitons<T>(): Promise<T[]> {
  const content = await readFile('./parity/definitions.json', 'utf-8');
  return JSON.parse(content);
}

export async function getBunRedisBackendConnection() {
  // Bun is not guaranteed to be there on every run
  const { RedisClient } = await import('bun');
  const port = process.env.PARITY_BACKEND_PORT;
  const rawClient = new RedisClient(`redis://localhost:${port}`);

  const connection = createBunRedisClient(rawClient);

  return connection;
}
