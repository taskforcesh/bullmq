import { defineConfig } from 'vitest/config';

/**
 * Runs the **shared** BullMQ test suite against the PostgreSQL backend — the
 * exact same `tests/**` files the Redis suites use, so feature parity and
 * robustness are measured against the real suite (not bespoke smoke tests).
 *
 * The default backend factory is swapped to PostgreSQL in the setup file; the
 * test connection factory stays ioredis for the suite's raw-connection helpers,
 * so both a PostgreSQL and a Redis server must be running.
 *
 *   POSTGRES_URL=postgres://postgres:postgres@localhost:5432/bullmq_test \
 *     npx vitest run --no-file-parallelism --config vitest.postgres.config.ts
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      // Redis-only suites: tests for Redis-specific internals (raw key layout,
      // deprecated keys, ioredis/cluster wiring) that have no backend-agnostic
      // equivalent. Named `*.redis.test.ts` by convention.
      'tests/**/*.redis.test.ts',

      // Redis-client-specific tests (direct ioredis/cluster/connection internals).
      'tests/cluster.test.ts',
      'tests/connection.test.ts',
      'tests/ioredis-client.test.ts',

      // Adapter-specific smoke tests (self-contained, not factory-based).
      'tests/node-redis.test.ts',
      'tests/adapter-conformance.test.ts',
      'tests/bun-redis.test.ts',
      'tests/bun-adapter-suite.test.ts',

      // PostgreSQL backend smoke tests (run via vitest.postgres.smoke.config.ts).
      'tests/postgres/**',

      // Sandboxed processes reconstruct jobs in a child process (Redis-specific
      // wiring for now).
      'tests/sandboxed_process.test.ts',

      // Old mocha-era files and debug/scratch files.
      'tests/test_*.ts',
      'tests/debug-*.test.ts',

      'node_modules/**',
    ],
    setupFiles: ['./vitest.postgres.setup.ts'],
    globalSetup: ['./vitest.postgres.global-setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
