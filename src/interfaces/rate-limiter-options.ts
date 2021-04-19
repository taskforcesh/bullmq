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
   * It is possible to define a rate limiter based on group keys,
   * for example you may want to have a rate limiter per customer
   * instead of a global rate limiter for all customers
   *
   * @see {@link https://docs.bullmq.io/guide/rate-limiting}
   */
  groupKey?: string;

  /**
   * This option enables a heuristic so that when a queue is heavily
   * rete limited, it delays the workers so that they do not try
   * to pick jobs when there is no point in doing so.
   * Note: It is not recommended to use this option when using
   * groupKeys unless you have a big amount of workers since
   * you may be delaying workers that could pick jobs in groups that
   * have not been rate limited.
   */
  workerDelay?: boolean;
}
