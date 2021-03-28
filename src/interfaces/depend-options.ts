/**
 * Settings for depend jobs.
 */
export interface DependOptions {
  /**
   * Id of the depend job.
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
