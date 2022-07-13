import { RepeatStrategy } from '../types';

export interface AdvancedRepeatOptions {
  /**
   * A set of custom cron strategies keyed by name.
   */
  repeatStrategy?: RepeatStrategy;
}

export interface AdvancedOptions extends AdvancedRepeatOptions {
  /**
   * A set of custom backoff strategies keyed by name.
   */
  backoffStrategies?: {};
}
