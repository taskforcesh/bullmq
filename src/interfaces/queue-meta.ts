/**
 * Metadata about a Queue, stored under the queue's Redis `meta` key.
 *
 * These values mirror the configuration applied via `Queue.setGlobalConcurrency`,
 * `Queue.setGlobalRateLimit`, and the queue's pause/version state.
 */
export interface QueueMeta {
  /**
   * Maximum number of jobs that can be processed concurrently across all
   * workers attached to this queue. Set via `Queue.setGlobalConcurrency`.
   */
  concurrency?: number;

  /**
   * Maximum number of jobs allowed in the rate-limit window of `duration`
   * milliseconds. Set via `Queue.setGlobalRateLimit`.
   */
  max?: number;

  /**
   * Length of the rate-limit window in milliseconds, paired with `max`.
   * Set via `Queue.setGlobalRateLimit`.
   */
  duration?: number;

  /**
   * Maximum length of the queue's events stream (`MAXLEN ~ N`).
   * Older events are evicted in roughly-FIFO order when this is exceeded.
   */
  maxLenEvents?: number;

  /**
   * True when the queue has been paused. While paused, workers will not
   * pick up new jobs.
   */
  paused?: boolean;

  /**
   * BullMQ version that produced this queue's data, used for compatibility
   * checks across upgrades.
   */
  version?: string;
}
