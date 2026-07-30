import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files follow the pattern *.test.ts (new Vitest tests)
    include: ['tests/**/*.test.ts'],

    // Exclude adapter-specific smoke tests, ioredis-specific tests, and legacy files.
    // The adapter-agnostic suite must be identical for ioredis, node-redis, and bun.
    // ioredis-specific tests (cluster, connection, sandboxed_process) run separately
    // via test:ioredis.
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

    // Global test timeout
    testTimeout: 10000,

    // Hook timeout
    hookTimeout: 10000,

    // Setup files (equivalent to mocha.setup.ts)
    setupFiles: ['./vitest.setup.ts'],

    // Run tests sequentially by default (can be overridden with --parallel)
    // This is important for Redis-based tests to avoid conflicts
    sequence: {
      concurrent: false,
    },

    // Reporter
    reporters: ['verbose'],

    // Coverage configuration.
    //
    // NOTE: `yarn coverage` uses `vitest.coverage.config.ts`, which runs the
    // union of the default and ioredis-only suites so adapter-agnostic and
    // ioredis-specific code paths (sandboxed_process, cluster, connection)
    // are both included. The settings here only apply to ad-hoc invocations
    // of `vitest --coverage` against this default config and intentionally
    // exclude modules that have no coverage in this suite.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/enums/*.ts', 'src/interfaces/*.ts'],
      reporter: ['text', 'lcov'],
      // Coverage thresholds (migrated from c8 config)
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },

    // Globals (describe, it, expect, etc.) - we'll use explicit imports instead
    globals: false,
  },
});
