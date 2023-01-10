import { JobsOptions, JobJsonSandbox } from '../types';
import { JobJson } from './job-json';
import { ParentKeys } from './parent';

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
 * MinimalJob
 */
export interface MinimalJob<
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
}
