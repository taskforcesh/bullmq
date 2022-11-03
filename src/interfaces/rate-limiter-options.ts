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
}
