import { BaseJobOptions, DebounceOptions } from '../interfaces';

/**
 * These options will be stored in Redis with smaller
 * keys for compactness.
 */
export type CompressableJobOptions = {
  /**
   * Debounce options.
   * @deprecated use deduplication option
   */
  debounce?: DebounceOptions;

  /**
   * Deduplication options.
   */
  deduplication?: DebounceOptions;

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
     * @default false
     */
    omitContext?: boolean;
  };
};

export type JobsOptions = BaseJobOptions & CompressableJobOptions;

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

  /**
   * TelemetryMetadata, provide for context propagation.
   */
  tm?: string;

  /**
   * Omit Context Propagation
   */
  omc?: boolean;

  /**
   * Deduplication identifier.
   * @deprecated use deid
   */
  de?: string;
};
