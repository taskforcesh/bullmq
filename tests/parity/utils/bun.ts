import { RedisClient } from 'bun';
import { createBunRedisClient } from '../../../src';

export async function getBunRedisBackendConnection() {
  const port = process.env.PARITY_BACKEND_PORT;

  const client = new RedisClient(`redis://localhost:${port}`);
  const connection = createBunRedisClient(client);

  return connection;
}
