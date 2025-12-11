/**
 * Retry method options
 */
export interface RetryOptions {
  /**
   * Attempts made counter is reset to zero when retrying the job.
   */
  resetAttemptsMade?: boolean;

  /**
   * Attempts started counter is reset to zero when retrying the job.
   */
  resetAttemptsStarted?: boolean;
}
