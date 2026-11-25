import { defineConfig } from 'vitest/config';

/**
 * Runs the PostgreSQL backend tests under `tests/postgres/**`.
 *
 *   POSTGRES_URL=postgres://127.0.0.1:5432/bullmq_test npx vitest run --config vitest.postgres.config.ts
 */
export default defineConfig({
  test: {
    include: [
      'tests/postgres/**/*.test.ts',
      // Backend-agnostic relay tests, run against PostgreSQL.
      'tests/relay.test.ts',
      'tests/relay_stress.test.ts',
    ],
    env: { BULLMQ_TEST_BACKEND: 'postgres' },
    exclude: ['node_modules/**'],
    testTimeout: 10000,
    hookTimeout: 10000,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
