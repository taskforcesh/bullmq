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
   * If true, when the deduplicated job is currently active (being processed),
   * allow a new job to be added to the queue instead of deduplicating.
   * This ensures at least one execution after the currently active job completes.
   * At most 2 jobs with the same dedup ID can exist: 1 active + 1 waiting.
   */
  requeueIfActive?: boolean;
};
