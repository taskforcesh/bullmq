import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/cluster.test.ts',
      'tests/connection.test.ts',
      'tests/sandboxed_process.test.ts',
      'tests/node-redis.test.ts',
      'tests/adapter-conformance.test.ts',
      'tests/bun-redis.test.ts',
      'tests/bun-adapter-suite.test.ts',
      'tests/valkey-glide-client.test.ts',
      'tests/test_*.ts',
      'tests/debug-*.test.ts',
      'node_modules/**',
    ],
    setupFiles: ['./vitest.valkey-glide.setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
