import { BaseJobOptions, DebouncingOptions } from '../interfaces';

export type JobsOptions = BaseJobOptions & {
  /**
   * Debouncing options.
   */
  debouncing?: DebouncingOptions;

  /**
   * If true, moves parent to failed.
   */
  failParentOnFailure?: boolean;

  /**
   * If true, moves the jobId from its parent dependencies to failed dependencies when it fails after all attempts.
   */
  ignoreDependencyOnFailure?: boolean;

  /**
   * If true, removes the job from its parent dependencies when it fails after all attempts.
   */
  removeDependencyOnFailure?: boolean;
};

/**
 * These fields are the ones stored in Redis with smaller keys for compactness.
 */
export type RedisJobOptions = BaseJobOptions & {
  /**
   * Debounce identifier.
   */
  deid?: string;

  /**
   * If true, moves parent to failed.
   */
  fpof?: boolean;

  /**
   * If true, moves the jobId from its parent dependencies to failed dependencies when it fails after all attempts.
   */
  idof?: boolean;

  /**
   * Maximum amount of log entries that will be preserved
   */
  kl?: number;

  /**
   * If true, removes the job from its parent dependencies when it fails after all attempts.
   */
  rdof?: boolean;
};
