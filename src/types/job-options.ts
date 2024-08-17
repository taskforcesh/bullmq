import { BaseJobOptions, DebounceOptions } from '../interfaces';

export type JobsOptions = BaseJobOptions & {
  /**
   * Debounce options.
   */
  debounce?: DebounceOptions;

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
   * Debounce identifier.
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
};
