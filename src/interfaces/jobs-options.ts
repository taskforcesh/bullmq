import { RepeatOptions } from './repeat-options';
import { BackoffOptions } from './backoff-options';
import { ParentOptions } from './parent-options';

export interface JobsOptions {
  /**
   * Defaults to `Date.now()`
   */
  timestamp?: number;

  /**
   * Ranges from 1 (highest priority) to MAX_INT (lowest priority). Note that
   * using priorities has a slight impact on performance,
   * so do not use it if not required.
   */
  priority?: number;

  /**
   * An amount of miliseconds to wait until this job can be processed.
   * Note that for accurate delays, worker and producers
   * should have their clocks synchronized.
   */
  delay?: number;

  /**
   * The total number of attempts to try the job until it completes.
   */
  attempts?: number;

  /**
   * Repeat this job, for example based on a `cron` schedule.
   */
  repeat?: RepeatOptions;

  /**
   * Rate limiter key to use if rate limiter enabled.
   *
   * @see {@link https://docs.bullmq.io/guide/rate-limiting}
   */
  rateLimiterKey?: string;

  /**
   * Backoff setting for automatic retries if the job fails
   */
  backoff?: number | BackoffOptions;

  /**
   * If true, adds the job to the right of the queue instead of the left (default false)
   *
   * @see {@link https://docs.bullmq.io/guide/jobs/lifo}
   */
  lifo?: boolean;

  /**
   * The number of milliseconds after which the job should be
   * fail with a timeout error.
   */
  timeout?: number;

  /**
   * Parent setting for tracking parent job reference.
   */
  parent?: string | ParentOptions;

  /**
   * Override the job ID - by default, the job ID is a unique
   * integer, but you can use this setting to override it.
   * If you use this option, it is up to you to ensure the
   * jobId is unique. If you attempt to add a job with an id that
   * already exists, it will not be added.
   */
  jobId?: string;

  /**
   * If true, removes the job when it successfully completes
   * When given an number, it specifies the maximum amount of
   * jobs to keep.
   * Default behavior is to keep the job in the completed set.
   */
  removeOnComplete?: boolean | number;

  /**
   * If true, removes the job when it fails after all attempts.
   * When given an number, it specifies the maximum amount of
   * jobs to keep.
   */
  removeOnFail?: boolean | number;

  /**
   * Limits the amount of stack trace lines that will be recorded in the stacktrace.
   */
  stackTraceLimit?: number;

  /**
   * Internal property used by repeatable jobs.
   */
  prevMillis?: number;
}
