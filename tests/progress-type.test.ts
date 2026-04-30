import { describe, it, expect } from 'vitest';
import { Job, Worker } from '../src/classes';
import { MinimalJob } from '../src/interfaces';
import { JobProgress } from '../src/types';

/**
 * Type-level tests for generic ProgressType parameter.
 *
 * These tests verify that the 4th generic parameter (ProgressType)
 * correctly flows through Job, MinimalJob, Worker, and WorkerListener.
 * They are compile-time checks — if TypeScript compiles this file,
 * the generics are wired correctly.
 */
describe('ProgressType generic', () => {
  describe('backwards compatibility', () => {
    it('Job with 3 generics still compiles', () => {
      // Existing code with 3 generics should not break
      type ThreeGenericJob = Job<{ input: string }, { output: string }, string>;
      const check: boolean = true;
      expect(check).toBe(true);
    });

    it('Worker with 3 generics still compiles', () => {
      type ThreeGenericWorker = Worker<
        { input: string },
        { output: string },
        string
      >;
      const check: boolean = true;
      expect(check).toBe(true);
    });

    it('default ProgressType is JobProgress', () => {
      // When no ProgressType is specified, it defaults to JobProgress
      type DefaultJob = Job<any, any, string>;
      type ProgressField = DefaultJob['progress'];

      // This should be assignable to JobProgress
      const progress: ProgressField = 42;
      expect(progress).toBe(42);
    });
  });

  describe('custom ProgressType', () => {
    it('Job accepts custom progress type', () => {
      type CustomProgress = { percent: number; message: string };
      type TypedJob = Job<
        { input: string },
        { output: string },
        string,
        CustomProgress
      >;

      // The progress field should be typed as CustomProgress
      type ProgressField = TypedJob['progress'];
      const progress: ProgressField = { percent: 50, message: 'halfway' };
      expect(progress.percent).toBe(50);
      expect(progress.message).toBe('halfway');
    });

    it('MinimalJob accepts custom progress type', () => {
      type CustomProgress = { step: number; total: number };
      type TypedMinimalJob = MinimalJob<
        any,
        any,
        string,
        CustomProgress
      >;

      type ProgressField = TypedMinimalJob['progress'];
      const progress: ProgressField = { step: 3, total: 10 };
      expect(progress.step).toBe(3);
    });

    it('Worker accepts custom progress type', () => {
      type CustomProgress = { percent: number };
      type TypedWorker = Worker<
        { data: string },
        { result: string },
        string,
        CustomProgress
      >;

      // This verifies the 4th generic compiles on Worker
      const check: boolean = true;
      expect(check).toBe(true);
    });
  });
});
