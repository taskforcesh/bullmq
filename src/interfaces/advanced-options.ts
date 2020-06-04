export interface AdvancedOptions {
  // A set of custom backoff strategies keyed by name.
  backoffStrategies?: {};
}

export const AdvancedOptionsDefaults: AdvancedOptions = {
  backoffStrategies: {},
};
