import { BackoffFunction } from '../classes/backoffs';

export interface AdvancedOptions {
  /**
   * A set of custom backoff strategies keyed by name.
   */
  backoffStrategies?: Record<string, BackoffFunction>;
}

export const AdvancedOptionsDefaults: AdvancedOptions = {
  backoffStrategies: {},
};
