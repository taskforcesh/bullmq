/**
 * Publicly relevant metadata fields for a Queue, read from the queue's
 * Redis `meta` key.
 *
 * This interface documents the subset of meta-hash fields that BullMQ
 * exposes to consumers (e.g. via `Queue.getQueueOpts`, `Queue.getRateLimit`,
 * `Queue.isPaused`); the underlying hash also stores internal fields
 * (e.g. metrics counters) that are not part of this type.
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
   * Approximate maximum length of the queue's events stream
   * (`XADD ... MAXLEN ~ N`). Older events are evicted in FIFO order.
   *
   * Note: this is a best-effort target — Redis's `~` (fast trim) mode
   * may retain more events than this value. Set without `~` semantics
   * is not exposed by BullMQ.
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
