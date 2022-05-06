import { JobOptionsBase } from '../interfaces';
import { RedisRepeatOptions, RepeatOptions } from '../types';

export type JobsOptions = JobOptionsBase & {
  repeatJobKey?: string;

  /**
   * Repeat this job, for example based on a `cron` schedule.
   */
  repeat?: RepeatOptions;
};

/**
 * These fields are the ones stored in Redis with smaller keys for compactness.
 */
export type RedisJobOptions = JobOptionsBase & {
  /**
   * Repeat this job, for example based on a `cron` schedule.
   */
  repeat?: RedisRepeatOptions;
};
