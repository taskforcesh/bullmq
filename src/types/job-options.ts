import { JobOptionsBase } from '../interfaces';

export type JobsOptions = JobOptionsBase & {
  /**
   * If true, removes the job from its parent dependencies when it fails after all attempts.
   */
  removeDependencyOnFail?: boolean;
};

export type RedisJobOptions = JobOptionsBase & {
  /**
   * If true, removes the job from its parent dependencies when it fails after all attempts.
   */
  rdof?: boolean;
};
