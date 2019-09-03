export interface AdvancedOpts {
  // How often check for stalled jobs (use 0 for never checking).
  stalledInterval?: number;

  // Max amount of times a stalled job will be re-processed.
  maxStalledCount?: number;

  // Poll interval for delayed jobs and added jobs.
  guardInterval?: number;

  // delay before processing next job in case of internal error.
  retryProcessDelay?: number;

  // A set of custom backoff strategies keyed by name.
  backoffStrategies?: {};

  // A timeout for when the queue is in drained state (empty waiting for jobs).
  drainDelay?: number;
}

export const AdvancedOptsDefaults: AdvancedOpts = {
  stalledInterval: 30000,
  maxStalledCount: 1,
  guardInterval: 5000,
  retryProcessDelay: 5000,
  backoffStrategies: {},
  drainDelay: 5,
};
