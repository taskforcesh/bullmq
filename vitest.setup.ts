/**
 * Vitest setup file - equivalent to mocha.setup.ts
 * This file runs before all tests
 */
import { expect } from 'vitest';
import { default as IORedis } from 'ioredis';
import { createIORedisClient } from './src/classes/ioredis-client';
import { setConnectionFactory } from './tests/connection-factory';

// Configure the default factory: ioredis
setConnectionFactory(opts => {
  const client = new IORedis({
    host: opts?.host || process.env.REDIS_HOST || 'localhost',
    port: opts?.port || Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
  });
  return createIORedisClient(client);
});

// Set longer timeout for CI environments
if (process.env.CI) {
  // Tests can use longer timeouts in CI
}

// Global test utilities
export const testPrefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
export const redisHost = process.env.REDIS_HOST || 'localhost';
