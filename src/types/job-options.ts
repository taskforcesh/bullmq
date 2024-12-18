import { BaseJobOptions, DeduplicationOptions } from '../interfaces';

/**
 * These options will be stored in Redis with smaller
 * keys for compactness.
 */
export type CompressableJobOptions = {
  /**
   * Deduplication options.
   */
  deduplication?: DeduplicationOptions;

  /**
   * Modes when a child fails: fail, ignore, remove, wait.
   * @defaultValue fail
   */
  onChildFailure?: 'fail' | 'ignore' | 'remove' | 'wait';

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
   * Deduplication identifier.
   */
  deid?: string;

  /**
   * Modes when a child fails: fail, ignore, remove, wait.
   */
  ocf?: 'fail' | 'ignore' | 'remove' | 'wait';

  /**
   * Maximum amount of log entries that will be preserved
   */
  kl?: number;

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
