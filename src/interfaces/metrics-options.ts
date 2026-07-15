/**
 * Options for configuring metrics collection on a queue.
 *
 * @see {@link https://docs.bullmq.io/guide/metrics}
 */
export interface MetricsOptions {
  /**
   * Maximum number of data points to keep for the metrics.
   * Each data point represents the number of finished jobs (completed or failed)
   * collected over a one-minute granularity window.
   */
  maxDataPoints?: number;
}
