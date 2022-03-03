import { JobOptionsBase } from '../interfaces';

export type JobsOptions = JobOptionsBase & {
  /**
   * If true, removes the job from its parent dependencies when it fails after all attempts.
   */
  removeDependencyOnFail?: boolean;
};

/**
 * These fields are the ones stored in Redis with smaller keys for compactness.
 */
export type RedisJobOptions = JobOptionsBase & {
  /**
   * If true, removes the job from its parent dependencies when it fails after all attempts.
   */
  rdof?: boolean;
};
