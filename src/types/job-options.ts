import { BaseJobOptions } from '../interfaces';

export type JobsOptions = BaseJobOptions & {
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
   * If true, it will rate limit the queue when moving this job into delayed.
   * Will stop rate limiting the queue until this job is moved to completed or failed.
   */
  ee?: boolean;

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
