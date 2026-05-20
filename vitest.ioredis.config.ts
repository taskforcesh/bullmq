import { defineConfig } from 'vitest/config';

/**
 * Vitest config for ioredis-specific tests (cluster, connection internals,
 * sandboxed_process). These tests directly import from ioredis or rely on
 * Node.js-specific behavior and only run against the default (ioredis) adapter.
 *
 * Usage:
 *   yarn test:ioredis
 */
export default defineConfig({
  test: {
    include: [
      'tests/cluster.test.ts',
      'tests/connection.test.ts',
      'tests/sandboxed_process.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
