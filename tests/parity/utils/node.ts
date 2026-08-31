import {
  BackendFactory,
  createPostgresBackend,
  createRedisBackend,
  PostgresQueueBackend,
  QueueOptions,
  RedisQueueBackend,
} from '../../../src';

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
