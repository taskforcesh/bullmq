import { defineConfig } from 'vitest/config';

/**
 * Smoke tests for the PostgreSQL backend (migrations + dedicated backend
 * tests under tests/postgres/**). The real conformance bar is the shared
 * suite — see vitest.postgres.config.ts.
 *
 * Assumes a PostgreSQL server is already running. Point it at your instance
 * with the `POSTGRES_URL` environment variable.
 */
export default defineConfig({
  test: {
    include: ['tests/postgres/**/*.test.ts'],
    exclude: ['node_modules/**'],
    testTimeout: 15000,
    hookTimeout: 15000,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
