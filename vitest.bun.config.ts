import { defineConfig } from 'vitest/config';

/**
 * Vitest config for running the full test suite against the Bun Redis adapter.
 *
 * Uses the same adapter-agnostic test files as ioredis and node-redis.
 * Requires bun as the runtime: bunx vitest run --config vitest.bun.config.ts
 *
 * Usage:
 *   bunx vitest run --config vitest.bun.config.ts
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

      // Node.js-specific tests (worker threads / child processes)
      'tests/child-pool.test.ts',

      // Stress tests that hang under bun due to bun Redis client limitations
      'tests/job_scheduler_stress.test.ts',

      // Old mocha-era files
      'tests/test_*.ts',

      // Debug/scratch files
      'tests/debug-*.test.ts',

      'node_modules/**',
    ],
    setupFiles: ['./vitest.bun.setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
