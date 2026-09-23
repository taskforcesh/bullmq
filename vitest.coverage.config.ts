import { defineConfig } from 'vitest/config';

/**
 * Vitest config used by `yarn coverage`.
 *
 * Runs every test that can execute against the default (ioredis) adapter,
 * i.e. the union of the main suite (`vitest.config.ts`) and the ioredis-only
 * suite (`vitest.ioredis.config.ts`). This ensures coverage includes modules
 * that are exercised only by ioredis-specific tests (sandbox, connection
 * internals, cluster, …).
 *
 * Adapter-specific tests for node-redis and bun are still excluded — their
 * coverage would require running the respective adapter test commands.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      // Adapter-specific smoke tests (not factory-based).
      'tests/node-redis.test.ts',
      'tests/adapter-conformance.test.ts',
      'tests/bun-redis.test.ts',
      'tests/bun-adapter-suite.test.ts',

      // PostgreSQL backend tests run in the dedicated PostgreSQL CI job.
      'tests/postgres/**',

      // Old mocha-era files.
      'tests/test_*.ts',

      // Debug/scratch files.
      'tests/debug-*.test.ts',

      'node_modules/**',
    ],

    testTimeout: 10000,
    hookTimeout: 10000,
    setupFiles: ['./vitest.setup.ts'],
    sequence: { concurrent: false },
    reporters: ['verbose'],

    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/enums/*.ts',
        'src/interfaces/*.ts',
        // Type-only modules.
        'src/types/**/*.ts',
        // Barrel files.
        'src/index.ts',
        'src/classes/index.ts',
        'src/classes/errors/index.ts',
        'src/postgres/index.ts',
        'src/postgres/migrations/index.ts',
        'src/scripts/index.ts',
        // Adapter implementations are exercised by their dedicated test
        // suites (`yarn test:bun`, `yarn test:node-redis`,
        // `yarn test:postgres`).
        'src/classes/bun-redis-client.ts',
        'src/classes/node-redis-client.ts',
        'src/postgres/**/*.ts',
        // These entrypoints execute in forked child processes / worker threads,
        // which the current Redis coverage run does not collect via V8.
        'src/classes/child-processor.ts',
        'src/classes/main-base.ts',
        'src/classes/main-worker.ts',
        'src/classes/main.ts',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
