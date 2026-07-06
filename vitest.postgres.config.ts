import { defineConfig } from 'vitest/config';

/**
 * Runs the **shared** BullMQ test suite against the PostgreSQL backend — the
 * exact same `tests/**` files the Redis suites use, so feature parity and
 * robustness are measured against the real suite (not bespoke smoke tests).
 *
 * The default backend factory is swapped to PostgreSQL in the setup file, and
 * the test connection factory becomes a no-op client, so this run needs **only
 * a PostgreSQL server** — no Redis.
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

      // Low-level SSCAN/HSCAN pagination of raw Redis sets/hashes built via the
      // raw client. The `paginate` feature over real BullMQ data (flow
      // dependencies) is covered by the getters/flow suites on every backend.
      'tests/scripts.test.ts',

      // Adapter-specific smoke tests (self-contained, not factory-based).
      'tests/node-redis.test.ts',
      'tests/adapter-conformance.test.ts',
      'tests/bun-redis.test.ts',
      'tests/bun-adapter-suite.test.ts',

      // PostgreSQL backend smoke tests (run via vitest.postgres.smoke.config.ts).
      'tests/postgres/**',

      // Sandboxed processors: like the Redis suites (which run these via
      // `test:ioredis`'s include list), this is a separate, build-dependent
      // suite — the child-process fixtures `require('dist/cjs/...')` and some
      // spawn their own raw Redis connections. It passes on Postgres (94/96,
      // 2 genuinely Redis-coupled child fixtures skipped) but must be run after
      // `yarn build` with a Redis server available, so it is not part of the
      // no-Redis main run.
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
