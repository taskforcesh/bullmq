/**
 * Settings for backing off failed jobs.
 *
 * @see {@link https://docs.bullmq.io/guide/retrying-failing-jobs}
 */
export interface BackoffOptions {
  /**
   * Name of the backoff strategy.
   */
  type: 'fixed' | 'exponential' | 'jitter' | (string & {});

  /**
   * Delay in milliseconds.
   */
  delay?: number;

  /**
   * Percentage of delay to be affected by jitter.
   * @defaultValue 1
   */
  percentage?: number;
}
