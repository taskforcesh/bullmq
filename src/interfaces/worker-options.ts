import { Job } from '../classes/job';
import { AdvancedOptions } from './advanced-options';
import { QueueBaseOptions } from './queue-options';
import { RateLimiterOptions } from './rate-limiter-options';
import { MetricsOptions } from './metrics-options';

/**
 * An async function that receives `Job`s and handles them.
 */
export type Processor<T = any, R = any, N extends string = string> = (
  job: Job<T, R, N>,
  token?: string,
) => Promise<R>;

export interface WorkerOptions extends QueueBaseOptions {
  /**
   * Condition to start processor at instance creation.
   */
  autorun?: boolean;
  /**
   * Amount of jobs that a single worker is allowed to work on
   * in parallel.
   *
   * @see {@link https://docs.bullmq.io/guide/workers/concurrency}
   */
  concurrency?: number;
  /**
   * Enable rate limiter
   * @see {@link https://docs.bullmq.io/guide/rate-limiting}
   */
  limiter?: RateLimiterOptions;

  /**
   * Enable collect metrics.
   * @see {@link https://docs.bullmq.io/guide/metrics}
   */
  metrics?: MetricsOptions;

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
