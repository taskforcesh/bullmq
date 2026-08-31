import { RedisClient } from 'bun';
import { createBunRedisClient } from '../../../src';

export async function getBunRedisBackendConnection() {
  const port = process.env.PARITY_BACKEND_PORT;
  const connection = createBunRedisClient(
    RedisClient,
    `redis://localhost:${port}`,
  );

  return connection;
}
