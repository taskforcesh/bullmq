import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test files follow the pattern *.test.ts (new Vitest tests)
    include: ['tests/**/*.test.ts'],

    // Exclude old mocha tests (test_*.ts pattern)
    exclude: ['tests/test_*.ts', 'node_modules/**'],

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

    // Coverage configuration
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/enums/*.ts', 'src/interfaces/*.ts'],
      reporter: ['text', 'lcov'],
    },

    // Globals (describe, it, expect, etc.) - we'll use explicit imports instead
    globals: false,
  },
});
