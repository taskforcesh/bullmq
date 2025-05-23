import { BackoffOptions } from './backoff-options';
import { KeepJobs } from './keep-jobs';
import { ParentOptions } from './parent-options';
import { RepeatOptions } from './repeat-options';

export interface DefaultJobOptions {
  /**
   * Timestamp when the job was created.
   * @defaultValue Date.now()
   */
  timestamp?: number;

  /**
   * Ranges from 0 (highest priority) to 2 097 152 (lowest priority). Note that
   * using priorities has a slight impact on performance,
   * so do not use it if not required.
   * @defaultValue 0
   */
  priority?: number;

  /**
   * An amount of milliseconds to wait until this job can be processed.
   * Note that for accurate delays, worker and producers
   * should have their clocks synchronized.
   * @defaultValue 0
   */
  delay?: number;

  /**
   * The total number of attempts to try the job until it completes.
   * @defaultValue 0
   */
  attempts?: number;

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
   * If true, removes the job when it successfully completes
   * When given a number, it specifies the maximum amount of
   * jobs to keep, or you can provide an object specifying max
   * age and/or count to keep. It overrides whatever setting is used in the worker.
   * Default behavior is to keep the job in the completed set.
   */
  removeOnComplete?: boolean | number | KeepJobs;

  /**
   * If true, removes the job when it fails after all attempts.
   * When given a number, it specifies the maximum amount of
   * jobs to keep, or you can provide an object specifying max
   * age and/or count to keep. It overrides whatever setting is used in the worker.
   * Default behavior is to keep the job in the failed set.
   */
  removeOnFail?: boolean | number | KeepJobs;

  /**
   * Maximum amount of log entries that will be preserved
   */
  keepLogs?: number;

  /**
   * Limits the amount of stack trace lines that will be recorded in the stacktrace.
   */
  stackTraceLimit?: number;

  /**
   * Limits the size in bytes of the job's data payload (as a JSON serialized string).
   */
  sizeLimit?: number;
}

export interface BaseJobOptions extends DefaultJobOptions {
  /**
   * Repeat this job, for example based on a `cron` schedule.
   */
  repeat?: RepeatOptions;

  /**
   * Internal property used by repeatable jobs to save base repeat job key.
   */
  repeatJobKey?: string;

  /**
   * Override the job ID - by default, the job ID is a unique
   * integer, but you can use this setting to override it.
   * If you use this option, it is up to you to ensure the
   * jobId is unique. If you attempt to add a job with an id that
   * already exists, it will not be added.
   */
  jobId?: string;

  /**
   * Parent options
   */
  parent?: ParentOptions;

  /**
   * Internal property used by repeatable jobs.
   */
  prevMillis?: number;
}
