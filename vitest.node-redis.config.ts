import { defineConfig } from 'vitest/config';

/**
 * Vitest config for running the full test suite against node-redis.
 *
 * Uses the same test files as the default (ioredis) suite, minus
 * ioredis-specific tests and adapter-specific smoke tests.
 *
 * Usage:
 *   npx vitest run --config vitest.node-redis.config.ts
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      // ioredis-specific tests (direct ioredis imports / cluster / connection internals)
      'tests/cluster.test.ts',
      'tests/connection.test.ts',
      'tests/sandboxed_process.test.ts',

      // Adapter-specific smoke tests (self-contained, not factory-based)
      'tests/node-redis.test.ts',
      'tests/adapter-conformance.test.ts',
      'tests/bun-redis.test.ts',
      'tests/bun-adapter-suite.test.ts',

      // PostgreSQL backend tests run in the dedicated PostgreSQL CI job.
      'tests/postgres/**',

      // Old mocha-era files
      'tests/test_*.ts',

      // Debug/scratch files
      'tests/debug-*.test.ts',

      'node_modules/**',
    ],
    setupFiles: ['./vitest.node-redis.setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
