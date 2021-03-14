/**
 * Settings for parent jobs.
 */
export interface ParentOptions {
  /**
   * Id of the parent job.
   */
  id: string;

  /**
   * Name of the queue related to parent job.
   */
  queueName?: string;

  /**
   * Prefix of the queue.
   */
  queuePrefix?: string;
}
