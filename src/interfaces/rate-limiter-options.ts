export interface RateLimiterOptions {
  /**
   * Max number of jobs to process in the time period
   * specified in `duration`.
   */
  max: number;

  /**
   * Time in milliseconds. During this time, a maximum
   * of `max` jobs will be processed.
   */
  duration: number;

  /**
   * This option enables a heuristic so that when a queue is heavily
   * rete limited, it delays the workers so that they do not try
   * to pick jobs when there is no point in doing so.
   */
  workerDelay?: boolean;
}
