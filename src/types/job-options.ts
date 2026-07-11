import { BaseJobOptions } from '../interfaces/base-job-options';
import { RepeatOptions } from '../interfaces/repeat-options';
import { DeduplicationOptions } from './deduplication-options';

/**
 * These options will be stored in Redis with smaller
 * keys for compactness.
 */
export type CompressableJobOptions = {
  /**
   * Debounce options.
   * @deprecated use deduplication option
   */
  debounce?: DeduplicationOptions;

  /**
   * Deduplication options.
   */
  deduplication?: DeduplicationOptions;

  /**
   * If true, moves parent to failed if any of its children fail.
   */
  failParentOnFailure?: boolean;

  /**
   * If true, starts processing parent job as soon as any
   * of its children fail.
   *
   */
  continueParentOnFailure?: boolean;

  /**
   * If true, moves the jobId from its parent dependencies to failed dependencies when it fails after all attempts.
   */
  ignoreDependencyOnFailure?: boolean;

  /**
   * If true, removes the job from its parent dependencies when it fails after all attempts.
   */
  removeDependencyOnFailure?: boolean;

  /**
   * Telemetry options
   */
  telemetry?: {
    /**
     * Metadata, used for context propagation.
     */
    metadata?: string;

    /**
     * If `true` telemetry will omit the context propagation
     * @defaultValue false
     */
    omitContext?: boolean;
  };
};

export type JobsOptions = BaseJobOptions & CompressableJobOptions;

/**
 * Internal job options for jobs produced by a `JobScheduler`. In addition to
 * the public {@link JobsOptions}, scheduler-produced jobs carry the repeat
 * settings the scheduler needs in order to schedule the next iteration. The
 * legacy-only `key` and `jobId` repeat fields are intentionally excluded.
 *
 * This type is internal: `repeat` is no longer a valid option for `Queue.add`;
 * use `Queue.upsertJobScheduler` to schedule repeating jobs.
 */
export interface JobSchedulerJobOptions extends JobsOptions {
  repeat?: Omit<RepeatOptions, 'key' | 'jobId'>;
}
