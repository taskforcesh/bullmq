import { BackoffStrategy, RepeatStrategy } from '../types';

export interface AdvancedRepeatOptions {
  /**
   * A custom cron strategy.
   */
  repeatStrategy?: RepeatStrategy;

  /**
   * A hash algorithm to be used when trying to create the job redis key.
   * Default - md5
   */
  repeatKeyHashAlgorithm?: string;
}

export interface AdvancedOptions extends AdvancedRepeatOptions {
  /**
   * A custom backoff strategy.
   */
  backoffStrategy?: BackoffStrategy;

  /**
   * Minimum blocking operation timeout in seconds used when fetching next job.
   * If timeout would be smaller than this defined threshold - because of next
   * delayed job would be available to be processed sooner - blocking operation
   * will not be used.
   *
   * @defaultValue 0.01
   */
  blockTimeoutThreshold?: number;
}
