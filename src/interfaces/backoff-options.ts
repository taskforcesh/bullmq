/**
 * Settings for backing off failed jobs.
 *
 * @see {@link https://docs.bullmq.io/guide/retrying-failing-jobs}
 */
export interface BackoffOptions {
  /**
   * Name of the backoff strategy.
   */
  type: 'fixed' | 'exponential' | (string & {});
  /**
   * Delay in milliseconds.
   */
  delay?: number;
}
