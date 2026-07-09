import { JobJson } from './job-json';
import { KeysMap } from '../classes/queue-keys';
import {
  DependenciesOpts,
  MinimalJob,
  MoveToDelayedOpts,
  MoveToWaitingChildrenOpts,
  RetryJobOpts,
} from './minimal-job';
import { ParentKeyOpts } from './parent';
import { QueueBaseOptions } from './queue-options';
import { RepeatableOptions } from './repeatable-options';
import { RetryOptions } from './retry-options';
import { StreamReadRaw } from './redis-streams';
import {
  FinishedStatus,
  JobProgress,
  JobsOptions,
  JobState,
  JobType,
  KeepJobs,
} from '../types';

/**
 * IQueueBackend
 *
 * Database-agnostic contract describing every *high-level* operation that the
 * {@link Queue}, {@link Worker} and {@link Job} classes need in order to
 * function. The goal of this interface is to express the queue semantics
 * ("move job to active", "extend lock", "promote job", …) **independently of
 * the underlying datastore**.
 *
 * Today the only implementation is the Redis adapter ({@link RedisQueueBackend}), which
 * fulfils every operation using Lua scripts and a small number of plain Redis
 * commands. A future implementation (e.g. PostgreSQL) could fulfil the very
 * same operations using SQL functions/procedures, `LISTEN`/`NOTIFY`, etc.,
 * without requiring any change to `Queue`, `Worker` or `Job`.
 *
 * The method names and signatures intentionally mirror the existing
 * `RedisQueueBackend` class so that the Redis adapter is a near
 * drop-in implementation.
 * Operations that used to be performed via direct datastore
 * commands scattered across the three classes (queue metadata, job getters,
 * the blocking "wait for next job" primitive, …) have been promoted into
 * this interface so that the three classes never need to talk to the
 * datastore directly.
 *
 * @remarks
 * Low-level, Redis-specific helpers (Lua KEYS/ARGV builders, error-code
 * mapping, `runCommand`, …) are deliberately **not** part of this contract.
 * They remain private implementation details of the Redis adapter.
 *
 * The interface intentionally exposes **no connection or transaction type**: a
 * concrete adapter owns its connection(s). For example, the Redis adapter is
 * built from a context that provides an {@link IRedisClient} (plus a dedicated
 * blocking client for {@link IQueueBackend.waitForJob}), so callers never
 * thread a connection or transaction through an operation.
 */
export interface IQueueBackend {
  // ============================================================
  // Connection lifecycle
  //
  // The backend owns its connection(s); the high-level classes (Queue,
  // Worker, FlowProducer, …) drive lifecycle exclusively through these
  // methods and never touch a datastore client directly.
  // ============================================================

  /**
   * Resolves once the backend's underlying connection(s) are ready to accept
   * operations.
   */
  waitUntilReady(): Promise<void>;

  /**
   * Closes the backend and its underlying connection(s), waiting for any
   * in-flight work to settle.
   *
   * @param force - When `true`, forcibly tears down the connection(s) without
   * waiting for in-flight (e.g. blocking) commands to finish.
   */
  close(force?: boolean): Promise<void>;

  /**
   * Truthy once {@link IQueueBackend.close} has begun (resolves when the close
   * completes). Used by the worker to decide whether it is still safe to issue
   * datastore operations (e.g. completing the current job) while the
   * higher-level instance is shutting down.
   */
  readonly closing: Promise<void> | undefined;

  /**
   * Forcibly disconnects the backend's underlying connection(s).
   */
  disconnect(): Promise<void>;

  /**
   * Sets a human-readable name on the underlying connection (for
   * observability). No-op for backends that have no such concept.
   */
  setName(name: string): Promise<void>;

  /**
   * Smallest meaningful block timeout (in seconds) supported by the backend's
   * blocking primitive. Used by workers to bound `waitForJob`.
   */
  readonly minimumBlockTimeout: number;

  /**
   * Subscribes to normalized backend lifecycle events (`'ready'`, `'error'`,
   * `'close'`), derived from the underlying connection(s).
   */
  on(
    event: 'ready' | 'error' | 'close',
    listener: (...args: any[]) => void,
  ): this;
  once(
    event: 'ready' | 'error' | 'close',
    listener: (...args: any[]) => void,
  ): this;
  removeListener(event: string, listener: (...args: any[]) => void): this;

  /**
   * Returns a sibling backend bound to a different queue (by name) that shares
   * this backend's underlying connection(s).
   *
   * This is used by {@link FlowProducer}, which spans multiple queues over a
   * single connection: every node in a flow needs datastore operations scoped
   * to its own queue, but they must all reuse the same connection. The
   * returned backend has an independent identity (its operations target the
   * given queue) but does not own the connection, so closing it is a no-op on
   * the shared connection.
   *
   * @param queueName - The queue the sibling backend should operate on.
   * @param prefix - Optional key prefix for the target queue. Flows may span
   * queues under different prefixes, so when omitted the backend's own prefix
   * is used.
   */
  forQueue(queueName: string, prefix?: string): IQueueBackend;

  // ============================================================
  // Queue identity & key building
  //
  // The qualified name and key/identifier construction are owned by the
  // backend, because how a queue (and its sub-keys) is addressed is a
  // datastore concern. For Redis these encode the key `prefix`
  // (`"<prefix>:<queue>"`, `"<prefix>:<queue>:<type>"`); other backends format
  // their own identity (e.g. the PostgreSQL backend, whose namespace is a
  // schema, uses just `"<queue>"`). The high-level classes ask the backend for
  // these instead of building them from a `prefix` of their own.
  // ============================================================

  /**
   * The queue's fully-qualified name (the cross-backend logical identifier used
   * e.g. as a flow parent reference). Redis: `"<prefix>:<queue>"`.
   */
  readonly qualifiedName: string;

  /**
   * The map of named sub-keys/identifiers for the queue. For Redis these are
   * the concrete Redis keys; backends that don't address jobs by key may return
   * an empty map.
   */
  readonly keys: KeysMap;

  /**
   * Builds a namespaced sub-key/identifier of the given `type` for this queue
   * (e.g. a job's `"<qualifiedName>:<id>:dependencies"` key).
   */
  toKey(type: string): string;

  /**
   * Parses a flow child/dependency node key (`"<qualifiedName>:<id>"`) back
   * into the components needed to locate the job: its queue keyspace `prefix`
   * (empty for backends without a prefix), `queueName` and `id`. Inverse of the
   * backend's key format; used when walking a flow tree.
   */
  parseNodeKey(key: string): { prefix: string; queueName: string; id: string };

  /**
   * Builds the connection client name (used for `setName` and worker/queue
   * discovery). Redis: `"<prefix>:<base64(queue)><suffix>"`. Backends without a
   * client-name concept may return any stable string.
   */
  clientName(suffix?: string): string;

  // ============================================================
  // Adding jobs
  // ============================================================

  /**
   * Adds a single job to the queue, routing it to the correct initial state
   * (wait / delayed / prioritized / waiting-children) based on its options.
   *
   * The backend uses its own connection — callers never pass one in.
   */
  addJob(
    job: JobJson,
    jobId: string,
    parentKeyOpts?: ParentKeyOpts,
  ): Promise<string>;

  /**
   * Adds many jobs to the queue in a single, efficient operation.
   *
   * How the insert is batched (a Redis pipeline, a single multi-row SQL
   * `INSERT`, a transaction, …) is entirely an implementation detail of the
   * backend; the contract only requires that all jobs are added and their ids
   * returned in order.
   *
   * @returns The generated ids, in the same order as `entries`.
   */
  addJobs(
    entries: {
      job: JobJson;
      jobId: string;
      parentKeyOpts?: ParentKeyOpts;
    }[],
  ): Promise<string[]>;

  /**
   * Atomically inserts a flow (tree) of jobs that may span multiple queues,
   * returning one `[error, idOrCode]` tuple per entry, in the same order they
   * were provided. Each entry is self-describing (it carries its own queue
   * `prefix`/`queueName`), so the operation is not bound to a single queue.
   *
   * For the Redis adapter this is a single `MULTI`; a SQL backend would use a
   * single transaction.
   */
  addFlow(
    entries: {
      jobData: JobJson;
      jobId: string;
      parentKeyOpts: ParentKeyOpts;
      prefix: string;
      queueName: string;
    }[],
  ): Promise<[Error | null, string | number][]>;

  /**
   * Registers a job scheduler and enqueues its next delayed iteration.
   *
   * Two job-option bags are involved, with deliberately different roles:
   * - `templateOpts` — the scheduler's *template* options, stored once and
   *   reused as the basis for every future iteration produced by the scheduler.
   * - `delayedJobOpts` — the fully-resolved options for the *single* delayed
   *   job created right now: the template plus this iteration's `jobId`,
   *   `delay`, `repeat.offset`/`count`, etc.
   *
   * @returns A tuple of `[jobId, delay]` for the next iteration.
   */
  addJobScheduler(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    templateOpts: JobsOptions,
    opts: RepeatableOptions,
    delayedJobOpts: JobsOptions,
    producerId?: string,
  ): Promise<[string, number]>;

  // ============================================================
  // Job state transitions
  // ============================================================

  /**
   * Atomically moves the next eligible job from wait/prioritized to active,
   * returning its data (or the delay/rate-limit signals when none is ready).
   */
  moveToActive(token: string, name?: string): Promise<any[]>;

  /**
   * Moves an active job to the completed state and, optionally, fetches the
   * next job to process.
   * @returns The next job data tuple when `fetchNext` is set, plus the
   * `finishedOn` timestamp that was recorded.
   */
  moveToCompleted<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    returnValue: R,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext: boolean,
  ): Promise<{ result: void | any[]; finishedOn: number }>;

  /**
   * Moves an active job to the failed state and, optionally, fetches the next
   * job to process.
   * @returns The next job data tuple when `fetchNext` is set, plus the
   * `finishedOn` timestamp that was recorded.
   */
  moveToFailed<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    failedReason: string,
    removeOnFail: boolean | number | KeepJobs,
    token: string,
    fetchNext: boolean,
    fieldsToUpdate?: Record<string, any>,
  ): Promise<{ result: void | any[]; finishedOn: number }>;

  /**
   * Moves a job to the delayed state, scheduling it to run after `delay` ms.
   */
  moveToDelayed(
    jobId: string,
    timestamp: number,
    delay: number,
    token?: string,
    opts?: MoveToDelayedOpts,
  ): Promise<void | any[]>;

  /**
   * Moves a parent job to the waiting-children state.
   * @returns `true` if moved, `false` if there are pending dependencies.
   */
  moveToWaitingChildren(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): Promise<boolean>;

  /**
   * Moves a (manually rate-limited) job from active back to wait.
   */
  moveJobFromActiveToWait(jobId: string, token?: string): Promise<number>;

  /**
   * Retries a failed/active job immediately by pushing it back to wait.
   */
  retryJob(
    jobId: string,
    lifo: boolean,
    token?: string,
    opts?: RetryJobOpts,
  ): Promise<void>;

  /**
   * Reprocesses a finished (failed/completed) job, moving it back to wait.
   */
  reprocessJob<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    state: 'failed' | 'completed',
    opts?: RetryOptions,
  ): Promise<void>;

  /**
   * Promotes a single delayed job so it can be processed as soon as possible.
   */
  promote(jobId: string): Promise<void>;

  /**
   * Recovers stalled jobs (active jobs whose lock expired) back to wait.
   * @returns The ids of the jobs that were moved.
   */
  moveStalledJobsToWait(): Promise<string[]>;

  // ============================================================
  // Bulk admin transitions
  // ============================================================

  /**
   * Moves up to `count` finished jobs of the given `state` back to wait.
   * @returns A cursor; `0` when there are no more jobs to move.
   */
  retryJobs(
    state?: FinishedStatus,
    count?: number,
    timestamp?: number,
  ): Promise<number>;

  /**
   * Promotes up to `count` delayed jobs back to wait.
   * @returns A cursor; `0` when there are no more jobs to promote.
   */
  promoteJobs(count?: number): Promise<number>;

  /**
   * Pauses or resumes the whole queue.
   */
  pause(pause: boolean): Promise<void>;

  /**
   * Removes waiting (and optionally delayed) jobs from the queue.
   */
  drain(delayed: boolean): Promise<void>;

  /**
   * Removes jobs in a given state that are older than `timestamp`.
   * @returns The ids of the removed jobs.
   */
  cleanJobsInSet(
    set: string,
    timestamp: number,
    limit?: number,
  ): Promise<string[]>;

  /**
   * Irreversibly destroys the queue and all of its contents.
   * @returns A cursor; `0` when obliteration is complete.
   */
  obliterate(opts: { force: boolean; count: number }): Promise<number>;

  /**
   * Removes orphaned job keys that exist in the datastore but are not
   * referenced by any queue state set.
   * @returns The total number of orphaned jobs removed.
   */
  removeOrphanedJobs(count?: number, limit?: number): Promise<number>;

  // ============================================================
  // Locks
  // ============================================================

  /**
   * Extends the lock of a single active job.
   */
  extendLock(jobId: string, token: string, duration: number): Promise<number>;

  /**
   * Extends the lock of several active jobs at once.
   * @returns The ids of the jobs whose lock could not be extended.
   */
  extendLocks(
    jobIds: string[],
    tokens: string[],
    duration: number,
  ): Promise<string[]>;

  // ============================================================
  // Job mutations
  // ============================================================

  /**
   * Replaces a job's data payload.
   */
  updateData<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    data: T,
  ): Promise<void>;

  /**
   * Updates a job's progress and emits the corresponding event.
   */
  updateProgress(jobId: string, progress: JobProgress): Promise<void>;

  /**
   * Appends a row to a job's log, optionally trimming old entries.
   * @returns The total number of log entries.
   */
  addLog(jobId: string, logRow: string, keepLogs?: number): Promise<number>;

  /**
   * Clears a job's logs, optionally keeping the most recent `keepLogs` rows.
   */
  clearLogs(jobId: string, keepLogs?: number): Promise<void>;

  /**
   * Changes the delay of a delayed job.
   */
  changeDelay(jobId: string, delay: number): Promise<void>;

  /**
   * Changes the priority (and optionally lifo) of a waiting job.
   */
  changePriority(
    jobId: string,
    priority?: number,
    lifo?: boolean,
  ): Promise<void>;

  /**
   * Removes a job and (optionally) its children.
   * @returns `1` if removed, `0` if it (or a dependency) was locked.
   */
  remove(jobId: string, removeChildren: boolean): Promise<number>;

  /**
   * Removes all unprocessed children of a job.
   */
  removeUnprocessedChildren(jobId: string): Promise<void>;

  /**
   * Removes the child→parent dependency for a not-yet-finished child.
   * @returns `true` if the dependency existed and was removed.
   */
  removeChildDependency(jobId: string, parentKey: string): Promise<boolean>;

  /**
   * Removes a deduplication key if it still maps to the given job.
   * @returns `1` if removed, `0` otherwise.
   */
  removeDeduplicationKey(
    deduplicationId: string,
    jobId: string,
  ): Promise<number>;

  /**
   * Unconditionally deletes a deduplication key.
   * @returns The number of keys removed.
   */
  deleteDeduplicationKey(deduplicationId: string): Promise<number>;

  // ============================================================
  // Job schedulers
  // ============================================================

  updateJobSchedulerNextMillis(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    delayedJobOpts: JobsOptions,
    producerId?: string,
  ): Promise<string | null>;

  removeJobScheduler(jobSchedulerId: string): Promise<number>;

  getJobScheduler(id: string): Promise<[any, string | null]>;

  /**
   * Returns whether an id corresponds to a registered job scheduler.
   */
  isJobScheduler(id: string): Promise<boolean>;

  /**
   * Returns the raw stored metadata hash for a job scheduler.
   */
  getJobSchedulerData(key: string): Promise<Record<string, string>>;

  /**
   * Returns a range of scheduler keys with their next-run scores, flattened as
   * `[key, score, key, score, …]`.
   */
  getJobSchedulersRange(
    start: number,
    end: number,
    asc: boolean,
  ): Promise<string[]>;

  /**
   * Returns the number of registered job schedulers.
   */
  getJobSchedulersCount(): Promise<number>;

  // ============================================================
  // Queue / job queries
  // ============================================================

  /**
   * Returns the current state of a job.
   */
  getState(jobId: string): Promise<JobState | 'unknown'>;

  /**
   * Returns whether a job has finished and (optionally) its result.
   */
  isFinished(
    jobId: string,
    returnValue?: boolean,
  ): Promise<number | [number, string]>;

  /**
   * Returns whether the queue has reached its concurrency limit.
   */
  isMaxed(): Promise<boolean>;

  /**
   * Returns whether a job id is present in a datastore list (wait/active).
   */
  isJobInList(listKey: string, jobId: string): Promise<boolean>;

  /**
   * Returns whether a job id is present in a datastore sorted set
   * (completed/failed/delayed/…).
   */
  isJobInZSet(set: string, jobId: string): Promise<boolean>;

  /**
   * Returns the stored data for a job, or `undefined` if it is missing.
   */
  getJobData(jobId: string): Promise<JobJson | undefined>;

  /**
   * Returns the job id currently holding the given deduplication key, if any.
   */
  getDeduplicationJobId(deduplicationId: string): Promise<string | null>;

  /**
   * Returns a page of a job's logs together with the total log count.
   */
  getJobLogs(
    jobId: string,
    start: number,
    end: number,
    asc: boolean,
  ): Promise<{ logs: string[]; count: number }>;

  /**
   * Returns the ttl (ms) of the current rate-limit window.
   */
  getRateLimitTtl(maxJobs?: number): Promise<number>;

  getCounts(types: JobType[]): Promise<number[]>;

  getCountsPerPriority(priorities: number[]): Promise<number[]>;

  getRanges(
    types: JobType[],
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<[string][]>;

  getDependencyCounts(jobId: string, types: string[]): Promise<number[]>;

  /**
   * Returns a job's children dependencies (processed/unprocessed/ignored/failed).
   */
  getDependencies(
    jobId: string,
    opts: DependenciesOpts,
  ): Promise<{
    nextFailedCursor?: number;
    failed?: string[];
    nextIgnoredCursor?: number;
    ignored?: Record<string, any>;
    nextProcessedCursor?: number;
    processed?: Record<string, any>;
    nextUnprocessedCursor?: number;
    unprocessed?: string[];
  }>;

  /**
   * Returns the raw processed-children map (child key → serialized value).
   */
  getProcessedChildrenValues(jobId: string): Promise<Record<string, string>>;

  /**
   * Returns the raw ignored-children failures map (child key → reason).
   */
  getIgnoredChildrenFailures(jobId: string): Promise<Record<string, string>>;

  getMetrics(
    type: 'completed' | 'failed',
    start?: number,
    end?: number,
  ): Promise<[string[], string[], number]>;

  /**
   * Returns the raw worker/client list(s) for the queue's datastore. For the
   * Redis adapter this is `CLIENT LIST` (one string per cluster node, or a
   * single string otherwise). Backends with no notion of connected clients
   * may return an empty array.
   */
  getClientList(): Promise<string[]>;

  /**
   * Paginates a datastore set or hash, optionally fetching the jobs themselves.
   */
  paginate(
    key: string,
    opts: { start: number; end: number; fetchJobs?: boolean },
  ): Promise<{
    cursor: string;
    items: { id: string; v?: any; err?: string }[];
    total: number;
    jobs?: JobJson[];
  }>;

  // ============================================================
  // Queue metadata & maintenance keys
  // ============================================================

  /**
   * Sets one or more queue metadata fields.
   */
  setQueueMeta(values: Record<string, string | number>): Promise<number>;

  /**
   * Reads a single queue metadata field.
   */
  getQueueMetaField(field: string): Promise<string | null>;

  /**
   * Reads several queue metadata fields at once, in order.
   */
  getQueueMetaFields(fields: string[]): Promise<(string | null)[]>;

  /**
   * Reads the entire queue metadata hash.
   */
  getQueueMeta(): Promise<Record<string, string>>;

  /**
   * Removes one or more queue metadata fields.
   */
  removeQueueMetaFields(fields: string[]): Promise<number>;

  /**
   * Returns whether a queue metadata field exists.
   */
  hasQueueMetaField(field: string): Promise<boolean>;

  /**
   * Sets the global rate-limit window for the next jobs.
   */
  setRateLimit(expireTimeMs: number): Promise<void>;

  /**
   * Removes the rate-limit key.
   * @returns The number of keys removed.
   */
  removeRateLimitKey(): Promise<number>;

  /**
   * Removes the deprecated priority helper key.
   * @returns The number of keys removed.
   */
  removeDeprecatedPriorityKey(): Promise<number>;

  /**
   * Trims the event stream to an approximate maximum length.
   * @returns The number of entries removed.
   */
  trimEvents(maxLength: number): Promise<number>;

  // ============================================================
  // Event stream
  // ============================================================

  /**
   * Publishes a custom event to the queue's event stream.
   * @returns The id of the appended event entry.
   */
  publishEvent(
    fields: Record<string, string | number>,
    maxEvents: number,
  ): Promise<string>;

  /**
   * Blocks (up to `blockTimeout` ms) reading the queue's event stream for
   * entries newer than `id`, returning the raw stream entries (or a falsy value
   * on timeout). For the Redis adapter this is an `XREAD ... BLOCK`.
   */
  readEvents(id: string, blockTimeout: number): Promise<StreamReadRaw>;

  // ============================================================
  // Worker blocking primitive
  // ============================================================

  /**
   * Blocks (up to `blockTimeout` seconds) until the queue signals that a new
   * job may be available, returning the next "block-until" timestamp.
   *
   * For the Redis adapter this is a `BZPOPMIN` on the marker sorted set using
   * the adapter's own dedicated blocking connection; other adapters may
   * implement it via `LISTEN`/`NOTIFY`, change-data-capture or polling.
   *
   * @returns The marker member/score on success, or `null` on timeout.
   */
  waitForJob(
    blockTimeout: number,
  ): Promise<{ member: string; score: number } | null>;

  /**
   * Interrupts the backend's in-flight blocking wait (so a worker can stop or
   * recover). No-op for backends without a dedicated blocking connection.
   */
  disconnectBlocking(wait?: boolean): Promise<void>;

  /**
   * Re-establishes the backend's blocking connection after an interrupt.
   */
  reconnectBlocking(): Promise<void>;
}

/**
 * Factory that builds an {@link IQueueBackend} for a given queue. Injected into
 * the queue classes so they depend only on the abstraction, never on a concrete
 * datastore/connection. The default factory is the Redis one
 * (`createRedisBackend`).
 *
 * The factory is generic over the concrete backend type `B` it produces, so a
 * caller (or class) parameterized on `B` keeps the concrete typing end-to-end
 * (e.g. `getBackend()` returning the concrete adapter instead of the bare
 * interface).
 */
export type BackendFactory<B extends IQueueBackend = IQueueBackend> = (
  name: string,
  opts: QueueBaseOptions,
  options?: {
    /** The backend's main connection is itself blocking (e.g. QueueEvents). */
    blocking?: boolean;
    /** Provision a dedicated blocking connection (workers). */
    withBlockingConnection?: boolean;
  },
) => B;
