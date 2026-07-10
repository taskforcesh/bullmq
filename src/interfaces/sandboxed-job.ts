import { JobJsonSandbox, JobProgress, JobsOptions } from '../types';
import { MoveToWaitingChildrenOpts } from './minimal-job';

/**
 * Shape of the job object passed to a sandboxed processor.
 *
 * Sandboxed processors run in a separate Node.js process and receive a
 * serialized snapshot of the job along with a small set of RPC-style helpers
 * that proxy back to the parent process. This interface describes both the
 * data fields and the helper methods exposed to the processor function.
 *
 * @see {@link https://docs.bullmq.io/guide/workers/sandboxed-processors}
 */
export interface SandboxedJob<T = any, R = any> extends Omit<
  JobJsonSandbox,
  'data' | 'opts' | 'returnvalue'
> {
  /**
   * The job's payload, as supplied to `queue.add(name, data)`.
   */
  data: T;

  /**
   * The options the job was created with (merged with the queue's default
   * job options).
   */
  opts: JobsOptions;

  /**
   * The fully qualified queue name (prefix + name) the job belongs to.
   */
  queueQualifiedName: string;

  /**
   * Moves the job to the delayed set, scheduling it to run again at
   * the given timestamp.
   *
   * @param timestamp - Absolute unix timestamp (ms) when the job should run.
   * @param token - The worker's lock token (required when the worker is locked).
   */
  moveToDelayed: (timestamp: number, token?: string) => Promise<void>;

  /**
   * Moves the job back to the wait queue so it can be picked up by another
   * worker.
   *
   * @param token - The worker's lock token (required when the worker is locked).
   */
  moveToWait: (token?: string) => Promise<void>;

  /**
   * Moves the job to the waiting-children state so it will only resume once
   * its child jobs complete.
   *
   * @param token - The worker's lock token.
   * @param opts - Options controlling which child of the job to wait for.
   * @returns `true` if the job was moved, `false` if there were no
   *   pending children to wait for.
   */
  moveToWaitingChildren: (
    token?: string,
    opts?: MoveToWaitingChildrenOpts,
  ) => Promise<boolean>;

  /**
   * Appends a row to the job's log, viewable via `queue.getJobLogs()`
   * and the BullMQ UI.
   *
   * @param row - The log entry to append.
   */
  log: (row: string) => void;

  /**
   * Replaces the job's `data` payload with a new value.
   *
   * @param data - The new payload to persist.
   */
  updateData: (data: T) => Promise<void>;

  /**
   * Updates the job's progress.
   *
   * @param value - A number (typically 0-100) or a custom progress object.
   */
  updateProgress: (value: JobProgress) => Promise<void>;

  /**
   * Returns the return values of this job's completed children, keyed by
   * `<queueQualifiedName>:<childJobId>`.
   */
  getChildrenValues: <CT = any>() => Promise<{ [jobKey: string]: CT }>;

  /**
   * Returns the failure reasons of this job's children whose failures were
   * ignored (i.e. did not propagate to the parent), keyed by
   * `<queueQualifiedName>:<childJobId>`.
   */
  getIgnoredChildrenFailures: () => Promise<{ [jobKey: string]: string }>;

  /**
   * Returns the number of children in each state, filtered by the requested
   * categories. When no opts are provided, all four counts are returned.
   *
   * @param opts - Which categories to include in the result.
   */
  getDependenciesCount: (opts?: {
    failed?: boolean;
    ignored?: boolean;
    processed?: boolean;
    unprocessed?: boolean;
  }) => Promise<{
    failed?: number;
    ignored?: number;
    processed?: number;
    unprocessed?: number;
  }>;

  /**
   * The value returned by the processor on a previous successful run, if any.
   */
  returnValue: R;
}
