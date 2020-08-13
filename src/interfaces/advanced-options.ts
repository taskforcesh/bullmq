export interface AdvancedOptions {
  // A set of custom backoff strategies keyed by name.
  backoffStrategies?: {};
  // Prevent the worker from automatically running jobs
  disableAutoRun?: boolean;
}

export const AdvancedOptionsDefaults: AdvancedOptions = {
  backoffStrategies: {},
  disableAutoRun: false,
};
