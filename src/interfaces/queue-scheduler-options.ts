import { QueueBaseOptions } from '../interfaces';

/**
 * Options for customizing the behaviour of the scheduler.
 *
 * @see {@link https://docs.bullmq.io/guide/jobs/stalled}
 * @see {@link https://docs.bullmq.io/guide/queuescheduler}
 */
export interface QueueSchedulerOptions extends QueueBaseOptions {
  autorun?: boolean;
  /**
   * Amount of times a job can be recovered from a stalled state
   * to the `wait` state. If this is exceeded, the job is moved
   * to `failed`.
   */
  maxStalledCount?: number;
  /**
   * Number of milliseconds between stallness checks.
   */
  stalledInterval?: number;
}
