/**
 * Vitest setup file for running the full test suite against node-redis.
 * Equivalent to vitest.setup.ts but wires the connection factory to
 * createNodeRedisClient instead of createIORedisClient.
 */
import { createClient } from 'redis';
import { createNodeRedisClient } from './src/classes/node-redis-client';
import { setConnectionFactory } from './tests/connection-factory';

setConnectionFactory(opts => {
  const raw = createClient({
    socket: {
      host: opts?.host || process.env.REDIS_HOST || 'localhost',
      port: opts?.port || Number(process.env.REDIS_PORT) || 6379,
    },
  });
  return createNodeRedisClient(raw as any);
});
