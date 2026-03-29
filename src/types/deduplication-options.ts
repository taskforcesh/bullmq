/**
 * Deduplication options
 */
export type DeduplicationOptions = {
  /**
   * Identifier
   */
  id: string;
} & {
  /**
   * ttl in milliseconds
   */
  ttl?: number;

  /**
   * Extend ttl value
   */
  extend?: boolean;

  /**
   * replace job record while it's in delayed state
   */
  replace?: boolean;

  /**
   * If true, when a job with the same deduplication ID already exists
   * and has not yet finished (for example, it is waiting, delayed,
   * prioritized, or active/being processed), the new job's data will
   * be stored and a follow-up job will be created or updated
   * automatically when the existing one finishes (completes or fails).
   * If multiple jobs are added while a non-finished job exists, only
   * the latest data is kept.
   *
   * This prevents parallel execution for the same deduplication ID and
   * ensures that, after the currently existing job completes, at most
   * one additional job using the most recent payload will be run.
   *
   * Note: when this option is set, `ttl` is ignored. The dedup key
   * is kept alive without expiry for the job's entire lifecycle and
   * cleaned up on completion or failure.
   */
  keepLastIfActive?: boolean;
};
