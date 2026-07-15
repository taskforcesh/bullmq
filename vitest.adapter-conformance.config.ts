import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the adapter conformance suite.
 *
 * Validates that an `IRedisClient` implementation correctly implements the
 * contract BullMQ expects. The suite is intentionally separate from the
 * adapter-agnostic factory-based suites because it constructs its own raw
 * client (currently node-redis) directly.
 *
 * Run with: `yarn test:adapter-conformance`
 */
export default defineConfig({
  test: {
    include: ['tests/adapter-conformance.test.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
