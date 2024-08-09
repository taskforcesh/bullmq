import { BaseJobOptions, DebounceOptions } from '../interfaces';

export type JobsOptions = BaseJobOptions & {
  /**
   * Debounce options.
   */
  debounce?: DebounceOptions;

  /**
   * If true, moves parent to failed.
   */
  failParentOnFailure?: boolean;

  /**
   * If true, moves the jobId from its parent dependencies to failed dependencies when it fails after all attempts.
   */
  ignoreDependencyOnFailure?: boolean;

  /**
   * Consider job as pending since it's move to active for the first time.
   */
  pending?: boolean;

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
   * Consider job as pending since it's move to active for the first time.
   */
  pen?: string;

  /**
   * If true, removes the job from its parent dependencies when it fails after all attempts.
   */
  rdof?: boolean;
};
