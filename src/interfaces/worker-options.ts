import { AdvancedOptions } from './advanced-options';
import { QueueBaseOptions } from './queue-options';
import { RateLimiterOptions } from './rate-limiter-options';
import { MetricsOptions } from './metrics-options';
import { KeepJobs } from '../types/keep-jobs';
import { Telemetry } from './telemetry';
import { SandboxedOptions } from './sandboxed-options';

export interface WorkerOptions extends QueueBaseOptions, SandboxedOptions {
  /**
   * Optional worker name. The name will be stored on every job
   * processed by this worker instance, and can be used to monitor
   * which worker is processing or has processed a given job.
   */
  name?: string;

  /**
   * Condition to start processor at instance creation.
   *
   * @defaultValue true
   */
  autorun?: boolean;

  /**
   * Amount of jobs that a single worker is allowed to work on
   * in parallel.
   *
   * @defaultValue 1
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
   * Maximum time in milliseconds where the job is idle while being rate limited.
   * While workers are idle because of a rate limiter, they won't fetch new jobs to process
   * and delayed jobs won't be promoted.
   * @defaultValue 30000
   */
  maximumRateLimitDelay?: number;

  /**
   * Defines the maximum number of times a job is allowed to start processing,
   * regardless of whether it completes or fails. Each time a worker picks up the job
   * and begins processing it, the attemptsStarted counter is incremented.
   * If this counter reaches maxStartedAttempts, the job will be moved to the failed state with an UnrecoverableError.
   * @defaultValue undefined
   */
  maxStartedAttempts?: number;

  /**
   * Amount of times a job can be recovered from a stalled state
   * to the `wait` state. If this is exceeded, the job is moved
   * to `failed`.
   *
   * @defaultValue 1
   */
  maxStalledCount?: number;

  /**
   * Number of milliseconds between stallness checks.
   *
   * @defaultValue 30000
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
   *  @defaultValue false
   */
  skipStalledCheck?: boolean;

  /**
   *  Skip lock renewal for this worker. If set to true, the lock will expire
   *  after lockDuration and moved back to the wait queue (if the stalled check is
   *  not disabled)
   *
   *  @defaultValue false
   */
  skipLockRenewal?: boolean;

  /**
   * Number of seconds to long poll for jobs when the queue is empty.
   *
   * @defaultValue 5
   */
  drainDelay?: number;

  /**
   * Duration of the lock for the job in milliseconds. The lock represents that
   * a worker is processing the job. If the lock is lost, the job will be eventually
   * be picked up by the stalled checker and move back to wait so that another worker
   * can process it again.
   *
   * @defaultValue 30000
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
   * @defaultValue 15000
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
   * @defaultValue false
   */
  useWorkerThreads?: boolean;

  /**
   * Telemetry Addon
   */
  telemetry?: Telemetry;
}

export interface GetNextJobOptions {
  block?: boolean;
}
