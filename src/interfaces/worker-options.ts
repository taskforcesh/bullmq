import { Job } from '../classes/job';
import { AdvancedOptions } from './advanced-options';
import { QueueBaseOptions } from './queue-options';
import { RateLimiterOptions } from './rate-limiter-options';
import { MetricsOptions } from './metrics-options';
import { KeepJobs } from './keep-jobs';

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
   *
   * @default true
   */
  autorun?: boolean;

  /**
   * Amount of jobs that a single worker is allowed to work on
   * in parallel.
   *
   * @default 1
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
   *
   * @default 1
   */
  maxStalledCount?: number;

  /**
   * Number of milliseconds between stallness checks.
   *
   * @default 30000
   */
  stalledInterval?: number;

  /**
   * You can provide an object specifying max
   * age and/or count to keep.
   * Default behavior is to keep the job in the completed set.
   */
  removeOnComplete?: KeepJobs;

  /**
   * You can provide an object specifying max
   * age and/or count to keep.
   * Default behavior is to keep the job in the failed set.
   */
  removeOnFail?: KeepJobs;

  /**
   *  Skip stalled check for this worker. Note that other workers could still
   *  perform stalled checkd and move jobs back to wait for jobs being processed
   *  by this worker.
   *
   *  @default false
   */
  skipStalledCheck?: boolean;

  /**
   *  Skip lock renewal for this worker. If set to true, the lock will expire
   *  after lockDuration and moved back to the wait queue (if the stalled check is
   *  not disabled)
   *
   *  @default false
   */
  skipLockRenewal?: boolean;

  /**
   *
   * Number of seconds to long poll for jobs when the queue is empty.
   *
   * @default 5
   */
  drainDelay?: number;

  /**
   *
   * Duration of the lock for the job in milliseconds. The lock represents that
   * a worker is processing the job. If the lock is lost, the job will be eventually
   * be picked up by the stalled checker and move back to wait so that another worker
   * can process it again.
   *
   * @default 30000
   */
  lockDuration?: number;

  /**
   * The time in milliseconds before the lock is automatically renewed.
   *
   * It is not recommended to modify this value, which is by default set to
   * halv the lockDuration value, which is optimal for most use cases.
   */
  lockRenewTime?: number;

  /**
   * This is an internal option that should not be modified.
   *
   * @default 15000
   */
  runRetryDelay?: number;

  /**
   * More advanced options.
   */
  settings?: AdvancedOptions;

  /**
   * Use Worker Threads instead of Child Processes.
   * Note: This option can only be used when specifying
   * a file for the processor argument.
   *
   * @default false
   */
  useWorkerThreads?: boolean;
}

export interface GetNextJobOptions {
  block?: boolean;
}
