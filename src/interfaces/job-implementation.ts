import { JobJson, ParentKeys, RedisClient } from '.';
import { ParentOpts } from './parent';
import {
  FinishedStatus,
  JobsOptions,
  JobState,
  JobJsonSandbox,
} from '../types';

export type BulkJobOptions = Omit<JobsOptions, 'repeat'>;

export interface MoveToWaitingChildrenOpts {
  child?: {
    id: string;
    queue: string;
  };
}

export interface DependenciesOpts {
  processed?: {
    cursor?: number;
    count?: number;
  };
  unprocessed?: {
    cursor?: number;
    count?: number;
  };
}

/**
 * JobImplementation
 */
export interface JobImplementation<
  DataType = any,
  ReturnType = any,
  NameType extends string = string,
> {
  /**
   * The name of the Job
   */
  name: NameType;
  /**
   * The payload for this job.
   */
  data: DataType;
  /**
   * The options object for this job.
   */
  opts: JobsOptions;
  id?: string;
  /**
   * The progress a job has performed so far.
   * @defaultValue 0
   */
  progress: number | object;
  /**
   * The value returned by the processor when processing this job.
   * @defaultValue null
   */
  returnvalue: ReturnType;
  /**
   * Stacktrace for the error (for failed jobs).
   * @defaultValue null
   */
  stacktrace: string[];
  /**
   * An amount of milliseconds to wait until this job can be processed.
   * @defaultValue 0
   */
  delay: number;
  /**
   * Timestamp when the job was created (unless overridden with job options).
   */
  timestamp: number;
  /**
   * Number of attempts after the job has failed.
   * @defaultValue 0
   */
  attemptsMade: number;
  /**
   * Reason for failing.
   */
  failedReason: string;
  /**
   * Timestamp for when the job finished (completed or failed).
   */
  finishedOn?: number;
  /**
   * Timestamp for when the job was processed.
   */
  processedOn?: number;
  /**
   * Fully qualified key (including the queue prefix) pointing to the parent of this job.
   */
  parentKey?: string;
  /**
   * Object that contains parentId (id) and parent queueKey.
   */
  parent?: ParentKeys;
  /**
   * Base repeat job key.
   */
  repeatJobKey?: string;
  /**
   * Prepares a job to be serialized for storage in Redis.
   * @returns
   */
  asJSON(): JobJson;
  /**
   * Prepares a job to be passed to Sandbox.
   * @returns
   */
  asJSONSandbox(): JobJsonSandbox;
  /**
   * Updates a job's data
   *
   * @param data - the data that will replace the current jobs data.
   */
  update(data: DataType): Promise<void>;
  /**
   * Updates a job's progress
   *
   * @param progress - number or object to be saved as progress.
   */
  updateProgress(progress: number | object): Promise<void>;
  /**
   * Logs one row of log data.
   *
   * @param logRow - string with log data to be logged.
   */
  log(logRow: string): Promise<number>;
  /**
   * Completely remove the job from the queue.
   * Note, this call will throw an exception if the job
   * is being processed when the call is performed.
   */
  remove(): Promise<void>;
  /**
   * Extend the lock for this job.
   *
   * @param token - unique token for the lock
   * @param duration - lock duration in milliseconds
   */
  extendLock(token: string, duration: number): Promise<number>;
  /**
   * Moves a job to the failed queue.
   *
   * @param err - the jobs error message.
   * @param token - token to check job is locked by current worker
   * @param fetchNext - true when wanting to fetch the next job
   * @returns void
   */
  moveToFailed<E extends Error>(
    err: E,
    token: string,
    fetchNext?: boolean,
  ): Promise<void>;
  /**
   * @returns true if the job has completed.
   */
  isCompleted(): Promise<boolean>;
  /**
   * @returns true if the job has failed.
   */
  isFailed(): Promise<boolean>;
  /**
   * @returns true if the job is delayed.
   */
  isDelayed(): Promise<boolean>;
  /**
   * @returns true if the job is waiting for children.
   */
  isWaitingChildren(): Promise<boolean>;
  /**
   * @returns true of the job is active.
   */
  isActive(): Promise<boolean>;
  /**
   * @returns true if the job is waiting.
   */
  isWaiting(): Promise<boolean>;
  /**
   * @returns the queue name this job belongs to.
   */
  get queueName(): string;
  /**
   * @returns the prefix that is used.
   */
  get prefix(): string;
  /**
   * @returns it includes the prefix, the namespace separator :, and queue name.
   * @see https://www.gnu.org/software/gawk/manual/html_node/Qualified-Names.html
   */
  get queueQualifiedName(): string;
  /**
   * Get current state.
   *
   * @returns Returns one of these values:
   * 'completed', 'failed', 'delayed', 'active', 'waiting', 'waiting-children', 'unknown'.
   */
  getState(): Promise<JobState | 'unknown'>;
  /**
   * Change delay of a delayed job.
   *
   * @param delay - milliseconds to be added to current time.
   * @returns void
   */
  changeDelay(delay: number): Promise<void>;
  /**
   * Get this jobs children result values if any.
   *
   * @returns Object mapping children job keys with their values.
   */
  getChildrenValues<CT = any>(): Promise<{
    [jobKey: string]: CT;
  }>;
  /**
   * Get children job keys if this job is a parent and has children.
   *
   * @returns dependencies separated by processed and unprocessed.
   */
  getDependencies(opts?: DependenciesOpts): Promise<{
    nextProcessedCursor?: number;
    processed?: Record<string, any>;
    nextUnprocessedCursor?: number;
    unprocessed?: string[];
  }>;
  /**
   * Get children job counts if this job is a parent and has children.
   *
   * @returns dependencies count separated by processed and unprocessed.
   */
  getDependenciesCount(opts?: {
    processed?: boolean;
    unprocessed?: boolean;
  }): Promise<{
    processed?: number;
    unprocessed?: number;
  }>;
  /**
   * Moves the job to the delay set.
   *
   * @param timestamp - timestamp where the job should be moved back to "wait"
   * @param token - token to check job is locked by current worker
   * @returns
   */
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
  /**
   * Moves the job to the waiting-children set.
   *
   * @param token - Token to check job is locked by current worker
   * @param opts - The options bag for moving a job to waiting-children.
   * @returns true if the job was moved
   */
  moveToWaitingChildren(
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): Promise<boolean>;
  /**
   * Promotes a delayed job so that it starts to be processed as soon as possible.
   */
  promote(): Promise<void>;
  /**
   * Attempts to retry the job. Only a job that has failed or completed can be retried.
   *
   * @param state - completed / failed
   * @returns If resolved and return code is 1, then the queue emits a waiting event
   * otherwise the operation was not a success and throw the corresponding error. If the promise
   * rejects, it indicates that the script failed to execute
   */
  retry(state?: FinishedStatus): Promise<void>;
  /**
   * Marks a job to not be retried if it fails (even if attempts has been configured)
   */
  discard(): void;
  /**
   * Adds the job to Redis.
   *
   * @param client -
   * @param parentOpts -
   * @returns
   */
  addJob(client: RedisClient, parentOpts?: ParentOpts): Promise<string>;
}
