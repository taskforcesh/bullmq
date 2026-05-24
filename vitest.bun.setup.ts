/**
 * Vitest setup file for running the full test suite against the Bun Redis adapter.
 * Equivalent to vitest.setup.ts but wires the connection factory to
 * createBunRedisClient instead of createIORedisClient.
 *
 * Requires bun as the runtime (vitest --pool bun).
 */
import { RedisClient } from 'bun';
import { createBunRedisClient } from './src/classes/bun-redis-client';
import { setConnectionFactory } from './tests/utils/connection-factory';

setConnectionFactory(opts => {
  const host = opts?.host || process.env.REDIS_HOST || 'localhost';
  const port = opts?.port || Number(process.env.REDIS_PORT) || 6379;
  const raw = new RedisClient(`redis://${host}:${port}`);
  return createBunRedisClient(raw);
});
