import { Job } from '../classes';
import { AdvancedOptions, QueueBaseOptions, RateLimiterOptions } from './';

/**
 * An async function that receives `Job`s and handles them.
 */
export type Processor<T = any, R = any, N extends string = string> = (
  job: Job<T, R, N>,
  token?: string,
) => Promise<R>;

export interface WorkerOptions extends QueueBaseOptions {
  /**
   * Amount of jobs that a single worker is allowed to work on
   * in parallel.
   *
   * @see {@link https://docs.bullmq.io/guide/workers/concurrency}
   */
  concurrency?: number;
  /**
   * @see {@link https://docs.bullmq.io/guide/rate-limiting}
   */
  limiter?: RateLimiterOptions;
  skipDelayCheck?: boolean;
  drainDelay?: number;
  lockDuration?: number;
  lockRenewTime?: number;
  runRetryDelay?: number;
  settings?: AdvancedOptions; // FIXME only backoffStrategies is used
}

export interface GetNextJobOptions {
  block?: boolean;
}
