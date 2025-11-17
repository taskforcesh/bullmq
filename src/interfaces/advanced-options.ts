import { BackoffStrategy } from '../types/backoff-strategy';
import { RepeatStrategy } from '../types/repeat-strategy';

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
}
