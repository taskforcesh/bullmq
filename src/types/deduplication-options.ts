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
   * If true, when a job with the same deduplication ID is currently
   * active (being processed), the new job's data will be stored and
   * a new job will be created automatically when the active one
   * finishes (completes or fails). If multiple jobs are added while
   * the active job is running, only the latest data is kept.
   *
   * This guarantees that at most 2 jobs per deduplication ID exist
   * at any time: 1 active and 1 waiting, preventing parallel
   * execution of jobs with the same deduplication ID.
   *
   * Note: when this option is set, `ttl` is ignored. The dedup key
   * is kept alive without expiry for the job's entire lifecycle
   * and cleaned up on completion or failure.
   */
  keepLastIfActive?: boolean;
};
