/**
 * Vitest setup file - equivalent to mocha.setup.ts
 * This file runs before all tests
 */
import { expect } from 'vitest';

// Extend Vitest's expect with custom matchers if needed
// For chai-as-promised like behavior, Vitest has built-in support for async assertions

// Set longer timeout for CI environments
if (process.env.CI) {
  // Tests can use longer timeouts in CI
}

// Global test utilities
export const testPrefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
export const redisHost = process.env.REDIS_HOST || 'localhost';
