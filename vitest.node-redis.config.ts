import { defineConfig } from 'vitest/config';

/**
 * Vitest config for running the node-redis smoke tests.
 *
 * Usage:
 *   npx vitest run --config vitest.node-redis.config.ts
 */
export default defineConfig({
  test: {
    include: ['tests/node-redis.test.ts', 'tests/adapter-conformance.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
