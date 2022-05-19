import { CronStrategy } from '../types';

export interface AdvancedRepeatOptions {
  /**
   * A set of custom cron strategies keyed by name.
   */
  cronStrategies?: Record<string, CronStrategy>;
}

export interface AdvancedOptions extends AdvancedRepeatOptions {
  /**
   * A set of custom backoff strategies keyed by name.
   */
  backoffStrategies?: {};
}
