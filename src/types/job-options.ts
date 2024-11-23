import { BaseJobOptions, DeduplicationOptions } from '../interfaces';

export type JobsOptions = BaseJobOptions & {
  /**
   * Deduplication options.
   */
  deduplication?: DeduplicationOptions;

  /**
   * Modes when a child fails: fail, ignore, remove, wait.
   * @defaultValue fail
   */
  onChildFailure?: 'fail' | 'ignore' | 'remove' | 'wait';
};

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
};
