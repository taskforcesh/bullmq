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
}
