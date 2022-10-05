import { BackoffStrategy, RepeatStrategy } from '../types';

export interface AdvancedRepeatOptions {
  /**
   * A custom cron strategy.
   */
  repeatStrategy?: RepeatStrategy;
}

export interface AdvancedOptions extends AdvancedRepeatOptions {
  /**
   * A custom backoff strategy.
   */
  backoffStrategy?: BackoffStrategy;
}
