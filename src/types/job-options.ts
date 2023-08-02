import { BaseJobOptions } from '../interfaces';

export type JobsOptions = BaseJobOptions & {
  /**
   * If true, moves parent to failed.
   */
  failParentOnFailure?: boolean;

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
   * If true, moves parent to failed.
   */
  fpof?: boolean;

  /**
   * Maximum amount of log entries that will be preserved
   */
  kl?: number;

  /**
   * If true, removes the job from its parent dependencies when it fails after all attempts.
   */
  rdof?: boolean;
};
