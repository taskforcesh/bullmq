import { EventEmitter } from 'events';
import {
  DependenciesOpts,
  IQueueBackend,
  JobJson,
  MinimalJob,
  MoveToDelayedOpts,
  MoveToWaitingChildrenOpts,
  ParentKeyOpts,
  QueueBaseOptions,
  RepeatableOptions,
  RetryJobOpts,
  RetryOptions,
  StreamReadRaw,
  WorkerOptions,
} from '../interfaces';
import {
  FinishedStatus,
  JobProgress,
  JobsOptions,
  JobState,
  JobType,
  KeepJobs,
} from '../types';
import { KeysMap } from '../classes/queue-keys';
import { finishedErrors } from '../classes/finished-errors';
import { PostgresConnection } from './postgres-connection';
import { PgNotification, PgListenClient, PgQueryResult } from './pg-types';
import { loadCommandSql } from './sql-loader';
/**
 * A raw `bullmq_job` row as returned by `pg`. `jsonb` columns arrive already
 * parsed; `bigint`/`int8` columns arrive as strings (node-postgres default).
 */
interface JobRow {
  queue: string;
  id: string;
  seq: string;
  name: string;
  state: string;
  data: any;
  opts: any;
  priority: number;
  delay_ms: string | null;
  max_attempts: number;
  attempts_made: number;
  attempts_started: number;
  progress: any;
  return_value: any;
  failed_reason: string | null;
  stacktrace: any;
  deferred_failure: string | null;
  processed_by: string | null;
  added_at_ms: string;
  process_at_ms: string | null;
  processed_at_ms: string | null;
  finished_at_ms: string | null;
  lock_token: string | null;
  locked_until_ms: string | null;
  stalled_count: number;
  dedup_id: string | null;
  scheduler_id: string | null;
  parent_queue: string | null;
  parent_id: string | null;
  parent_key: string | null;
  pending_deps: number;
}

/** Parses a nullable `bigint`-as-string column into a number, or `undefined`. */
function bigintOrUndefined(value: string | null): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

/** Max events fetched per readEvents round-trip. */
const EVENT_READ_BATCH = 100;

/** Strips `undefined` properties so the JSON shape matches the Redis backend. */
function removeUndefined<T extends Record<string, any>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) {
      delete obj[key];
    }
  }
  return obj;
}

/**
 * Normalizes a `removeOnComplete`/`removeOnFail` option into the retention
 * params the move_to_completed/failed functions take:
 * - `true` → remove the job immediately
 * - `false`/`undefined` → keep forever
 * - number → keep at most that many (most recent)
 * - `{ age, count }` → keep within age (seconds) and/or count
 */
function normalizeKeep(opt: boolean | number | KeepJobs | undefined): {
  removeAll: boolean;
  keepAge: number | null;
  keepCount: number | null;
} {
  if (opt === true) {
    return { removeAll: true, keepAge: null, keepCount: null };
  }
  if (opt === false || opt === undefined || opt === null) {
    return { removeAll: false, keepAge: null, keepCount: null };
  }
  if (typeof opt === 'number') {
    return { removeAll: false, keepAge: null, keepCount: opt };
  }
  const keep = opt as { age?: number; count?: number };
  return {
    removeAll: false,
    keepAge: keep.age ?? null,
    keepCount: keep.count ?? null,
  };
}

/**
 * Maps a `bullmq_job` row to the public {@link JobJson} shape consumed by
 * `Job.fromJSON`. JSON-string fields (`data`, `returnvalue`, `stacktrace`) are
 * re-stringified; `opts` is returned as the stored object.
 */
function rowToJobJson(row: JobRow): JobJson {
  return removeUndefined<JobJson>({
    id: row.id,
    name: row.name,
    data: JSON.stringify(row.data ?? {}),
    opts: row.opts ?? {},
    progress: row.progress ?? 0,
    attemptsMade: row.attempts_made ?? 0,
    attemptsStarted: row.attempts_started ?? 0,
    finishedOn: bigintOrUndefined(row.finished_at_ms),
    processedOn: bigintOrUndefined(row.processed_at_ms),
    timestamp: Number(row.added_at_ms),
    delay: bigintOrUndefined(row.delay_ms),
    priority: row.priority ?? undefined,
    failedReason: row.failed_reason ?? undefined,
    stacktrace: JSON.stringify(row.stacktrace ?? []),
    returnvalue: JSON.stringify(row.return_value ?? null),
    parent:
      row.parent_id != null
        ? { id: row.parent_id, queueKey: row.parent_queue ?? '' }
        : undefined,
    parentKey: row.parent_key ?? undefined,
    repeatJobKey: row.scheduler_id ?? undefined,
    deduplicationId: row.dedup_id ?? undefined,
    deferredFailure: row.deferred_failure ?? undefined,
    processedBy: row.processed_by ?? undefined,
    stalledCounter: row.stalled_count ?? 0,
  } as unknown as JobJson);
}

/**
 * Marks an {@link IQueueBackend} operation that the PostgreSQL backend does not
 * implement yet. The full operation set is being filled in incrementally
 * (vertical slice by vertical slice), so calling an unfinished operation fails
 * loudly rather than silently misbehaving.
 */
function notImplemented(op: string): never {
  throw new Error(
    `PostgresQueueBackend: operation '${op}' is not implemented yet.`,
  );
}

/** Raw `bullmq_scheduler` row as returned by the `get_job_scheduler` command. */
interface SchedulerRow {
  name: string | null;
  iteration_count: number | string | null;
  limit_count: number | string | null;
  start_date_ms: string | null;
  end_date_ms: string | null;
  tz: string | null;
  pattern: string | null;
  every_ms: string | null;
  offset_ms: string | null;
  template_data: unknown;
  template_opts: unknown;
  next_run_ms: string | null;
}

/**
 * Maps a scheduler row to the Redis-compatible metadata hash (string values,
 * absent fields omitted) plus the next-run score, matching the shape the
 * shared `JobScheduler` consumer expects.
 */
function mapSchedulerRow(row: SchedulerRow): {
  hash: Record<string, string>;
  next: string | null;
} {
  const hash: Record<string, string> = {};
  if (row.name != null) {
    hash.name = String(row.name);
  }
  if (row.iteration_count != null) {
    hash.ic = String(row.iteration_count);
  }
  if (row.limit_count != null) {
    hash.limit = String(row.limit_count);
  }
  if (row.start_date_ms != null) {
    hash.startDate = String(row.start_date_ms);
  }
  if (row.end_date_ms != null) {
    hash.endDate = String(row.end_date_ms);
  }
  if (row.tz != null) {
    hash.tz = String(row.tz);
  }
  if (row.pattern != null) {
    hash.pattern = String(row.pattern);
  }
  if (row.every_ms != null) {
    hash.every = String(row.every_ms);
  }
  if (row.offset_ms != null) {
    hash.offset = String(row.offset_ms);
  }
  if (row.template_data != null) {
    const data = JSON.stringify(row.template_data);
    if (data !== '{}') {
      hash.data = data;
    }
  }
  if (row.template_opts != null) {
    const opts = JSON.stringify(row.template_opts);
    if (opts !== '{}') {
      hash.opts = opts;
    }
  }
  return {
    hash,
    next: row.next_run_ms == null ? null : String(row.next_run_ms),
  };
}

/**
 * PostgreSQL implementation of {@link IQueueBackend}.
 *
 * Fulfils the same database-agnostic contract as {@link RedisQueueBackend}, but
 * backed by a PostgreSQL database: queue operations are expressed as SQL /
 * PL/pgSQL functions (created by the migrations), job state lives in a single
 * `job` table keyed by `(queue, id)` with a `state` column and partial
 * indexes, claiming uses `FOR UPDATE SKIP LOCKED`, and the blocking
 * "wait for job" primitive uses `LISTEN`/`NOTIFY`.
 *
 * The class owns its {@link PostgresConnection}; the high-level classes (Queue,
 * Worker, FlowProducer) depend only on {@link IQueueBackend} and never touch a
 * `pg` client directly.
 */
export class PostgresQueueBackend
  extends EventEmitter
  implements IQueueBackend
{
  closing: Promise<void> | undefined;

  /**
   * The PostgreSQL schema (namespace) this backend's queue lives in, taken from
   * the connection. All runtime SQL is qualified with it. BullMQ's per-queue
   * `prefix` is a Redis keyspace concern and is intentionally not part of the
   * SQL data model.
   */
  protected readonly schema: string;

  /** Whether the dedicated LISTEN client is subscribed to the jobs channel. */
  private listening = false;

  /** Whether the dedicated LISTEN client is subscribed to the events channel. */
  private listeningEvents = false;

  /**
   * Memoizes {@link PostgresQueueBackend.waitUntilReady} so every caller awaits
   * the same readiness — including the one-time connection naming it performs.
   */
  private readyPromise: Promise<void> | undefined;

  /** Cancels the in-flight {@link waitForJob}, if any (used by close/interrupt). */
  private cancelWait: (() => void) | undefined;

  /**
   * Set by {@link disconnectBlocking} to interrupt the blocking wait. Unlike
   * {@link cancelWait} (which only fires the *current* wait), this flag also
   * short-circuits a {@link waitForJob} that starts during/after the disconnect
   * — closing the race where the worker re-enters `waitForJob` (still awaiting
   * `ensureListening`) just as `close()` interrupts it, leaving it blocked on a
   * timer that, under faked timers, never fires. Cleared by
   * {@link reconnectBlocking}. (The Redis backend gets this for free: tearing
   * down the blocking socket interrupts even a freshly-issued `BZPOPMIN`.)
   */
  private blockingDisconnected = false;

  /** Cancels the in-flight {@link readEvents} wait, if any. */
  private cancelEventWait: (() => void) | undefined;

  constructor(
    public connection: PostgresConnection,
    protected readonly queueName: string,
    protected readonly opts: QueueBaseOptions,
    protected readonly ownsConnection = true,
    /**
     * When set, the name applied to this backend's dedicated connection (its
     * `application_name`) so getWorkers can discover it — the PostgreSQL
     * analogue of the Redis worker's named blocking connection. Only workers
     * pass it; QueueEvents name themselves via {@link setName}.
     */
    private readonly listenClientName?: string,
  ) {
    super();

    this.schema = connection.schema;

    if (this.ownsConnection) {
      this.connection.on('error', err => this.emit('error', err));
      this.connection.on('ready', () => this.emit('ready'));
      this.connection.on('close', () => this.emit('close'));
    }
  }

  // ============================================================
  // Connection lifecycle
  // ============================================================

  async waitUntilReady(): Promise<void> {
    // Memoized so every caller (the Worker's constructor 'ready' hook AND an
    // explicit waitUntilReady()) awaits the SAME readiness — including the
    // connection naming below. Without this a second caller could observe the
    // naming as "already started" and return before the first caller's setName
    // had actually completed, racing discovery (getWorkers/getQueueEvents).
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        await this.connection.waitUntilReady();
        // Name this backend's dedicated connection so it is discoverable via
        // getClientList (and thus getWorkers) — even an `autorun: false`
        // worker that never fetches is listed, matching the Redis backend
        // which names its blocking connection on creation. Best-effort: a
        // naming failure must never block readiness.
        if (this.listenClientName) {
          try {
            await this.setName(this.listenClientName);
          } catch {
            // Discovery is best-effort; leave the connection unnamed.
          }
        }
      })();
    }
    return this.readyPromise;
  }

  async close(force = false): Promise<void> {
    void force;
    if (!this.ownsConnection) {
      return;
    }
    if (!this.closing) {
      this.closing = this.connection.close();
    }
    return this.closing;
  }

  async disconnect(): Promise<void> {
    // Interrupt any in-flight blocking wait so a blocked readEvents/waitForJob
    // returns and the caller (e.g. QueueEvents.close) can proceed.
    this.cancelWait?.();
    this.cancelEventWait?.();
    if (!this.ownsConnection) {
      return;
    }
    await this.connection.disconnect();
  }

  async setName(name: string): Promise<void> {
    // Name the dedicated LISTEN connection via `application_name` — the
    // PostgreSQL analogue of Redis `CLIENT SETNAME`. This is the long-lived
    // connection a worker / QueueEvents holds, so it appears (under this name)
    // in pg_stat_activity and is therefore discoverable by getWorkers /
    // getQueueEvents via getClientList.
    await this.connection.waitUntilReady();
    const client = await this.connection.getListenClient();
    await client.query(`SELECT set_config('application_name', $1, false)`, [
      name,
    ]);
  }

  /**
   * PostgreSQL `LISTEN`/`NOTIFY` has no minimum block granularity, so any
   * positive timeout is fine; we mirror the Redis backend's smallest unit.
   */
  get minimumBlockTimeout(): number {
    return 0.001;
  }

  forQueue(queueName: string, _prefix?: string): IQueueBackend {
    // The namespace is the connection's schema, shared by all queues, so a
    // sibling backend only needs a different queue name. BullMQ's per-queue
    // `prefix` (a Redis keyspace concern) is ignored here.
    return new PostgresQueueBackend(
      this.connection,
      queueName,
      this.opts,
      false,
    );
  }

  /**
   * The queue's qualified name. With a schema-based namespace there is no
   * prefix, so the qualified name is simply the queue name.
   */
  get qualifiedName(): string {
    return this.queueName;
  }

  /**
   * Backends that don't address jobs by key return an empty map; PostgreSQL
   * addresses rows by `(queue, id)` columns instead.
   */
  get keys(): KeysMap {
    return {};
  }

  /**
   * Builds a namespaced identifier of the given `type` (`"<queue>:<type>"`),
   * used e.g. for flow dependency identifiers. No prefix is involved.
   */
  toKey(type: string): string {
    return `${this.queueName}:${type}`;
  }

  /**
   * Parses a PostgreSQL flow child key (`"<queue>:<id>"`) into its components.
   * There is no keyspace prefix, so `prefix` is always empty. Inverse of
   * {@link toKey}.
   */
  parseNodeKey(key: string): { prefix: string; queueName: string; id: string } {
    const idx = key.lastIndexOf(':');
    return {
      prefix: '',
      queueName: key.slice(0, idx),
      id: key.slice(idx + 1),
    };
  }

  /**
   * Returns a backend identifier used by the generic API; PostgreSQL discovery
   * relies on {@link setName} setting `application_name` on the dedicated
   * LISTEN client.
   */
  clientName(suffix = ''): string {
    return `${this.queueName}${suffix}`;
  }

  // ============================================================
  // SQL helpers
  // ============================================================

  /**
   * Runs a query on the connection's pool, first awaiting the connection's
   * (memoized) readiness so the schema/functions exist. This mirrors how the
   * ioredis client buffers commands until connected, letting callers (e.g. a
   * Worker's autorun loop) issue operations before `waitUntilReady` resolves.
   */
  private async query<R = any>(
    text: string,
    params?: readonly unknown[],
  ): Promise<PgQueryResult<R>> {
    await this.connection.waitUntilReady();
    // The owning connection may be shutting down (or already have ended its
    // pool). Issuing the query then throws a raw "Cannot use a pool after
    // calling end on the pool", which — for a fire-and-forget operation raced
    // in during teardown (e.g. an event handler still scheduling work after
    // close) — surfaces as an unhandled rejection. Mirror ioredis, whose
    // offline queue simply never settles a command issued against a closing
    // connection: return a promise that never resolves so such stragglers
    // neither crash nor pollute the run. This only triggers once close() has
    // begun, so no legitimate in-flight operation is affected.
    if (this.connection.isClosing) {
      return new Promise<PgQueryResult<R>>(() => undefined);
    }
    try {
      return await this.connection.pool.query<R>(text, params);
    } catch (err) {
      // Close the race where the pool is ended between the check above and the
      // query dispatch.
      if (
        this.connection.isClosing &&
        err instanceof Error &&
        err.message.includes('after calling end on the pool')
      ) {
        return new Promise<PgQueryResult<R>>(() => undefined);
      }
      throw err;
    }
  }

  /**
   * Loads a named `.sql` command file and runs it. The files contain no
   * schema/namespace references — the connection's `search_path` selects the
   * namespace — so they are portable verbatim to the other language ports.
   */
  private run<R = any>(
    command: string,
    params?: readonly unknown[],
  ): Promise<PgQueryResult<R>> {
    return this.query<R>(loadCommandSql(command), params);
  }

  /**
   * The processing worker's name (when this backend belongs to a Worker), used
   * to stamp `processedBy` on the next job fetched during a finish op.
   */
  private get workerName(): string | undefined {
    return (this.opts as { name?: string }).name;
  }

  /**
   * Re-throws a finish-op error (SQLSTATE `BM001`, whose DETAIL carries the
   * numeric `ErrorCode`) as the shared canonical error; passes anything else
   * through unchanged.
   */
  private mapFinishError(err: any, jobId: string, command: string): never {
    if (err && err.code === 'BM001') {
      throw finishedErrors({
        code: Number(err.detail),
        jobId,
        command,
        state: 'active',
      });
    }
    throw err;
  }

  // ============================================================
  // Adding jobs
  // ============================================================

  async addJob(
    job: JobJson,
    jobId: string,
    parentKeyOpts: ParentKeyOpts = {},
  ): Promise<string> {
    const opts = (job.opts ?? {}) as JobsOptions;
    const parentKey = parentKeyOpts.parentKey ?? job.parentKey ?? null;
    let rows: { id: string }[];
    try {
      ({ rows } = await this.run<{ id: string }>('add_job', [
        this.queueName,
        jobId || job.id || '',
        job.name,
        job.data ?? '{}',
        JSON.stringify(opts ?? {}),
        job.priority ?? opts.priority ?? 0,
        job.delay ?? opts.delay ?? 0,
        job.timestamp ?? Date.now(),
        opts.attempts ?? 1,
        job.parent?.queueKey ?? null,
        job.parent?.id ?? null,
        parentKey,
        job.deduplicationId ?? null,
        job.repeatJobKey ?? null,
        opts.lifo ?? false,
      ]));
    } catch (err: any) {
      if (err && err.code === 'BM001') {
        throw finishedErrors({
          code: Number(err.detail),
          jobId,
          parentKey: parentKey ?? undefined,
          command: 'addJob',
        });
      }
      throw err;
    }
    return rows[0].id;
  }

  async addJobs(
    entries: {
      job: JobJson;
      jobId: string;
      parentKeyOpts?: ParentKeyOpts;
    }[],
  ): Promise<string[]> {
    // Insert the whole batch in a single atomic statement so they all become
    // visible together (FIFO/priority ordering otherwise breaks: a worker could
    // claim an earlier-inserted lower-priority job before the rest land).
    const payload = entries.map(entry =>
      this.toBatchEntry(
        this.queueName,
        entry.job,
        entry.jobId,
        entry.parentKeyOpts,
      ),
    );
    const { rows } = await this.run<{ id: string }>('add_flow', [
      JSON.stringify(payload),
    ]);
    return rows.map(r => r.id);
  }

  /** Builds one entry of the JSONB batch consumed by `bullmq_add_flow`. */
  private toBatchEntry(
    queueName: string,
    data: JobJson,
    jobId: string,
    parentKeyOpts?: ParentKeyOpts,
  ): Record<string, unknown> {
    const opts = (data.opts ?? {}) as JobsOptions;
    return {
      queue: queueName,
      id: jobId || data.id || '',
      name: data.name,
      data: data.data ?? '{}',
      opts,
      priority: data.priority ?? opts.priority ?? 0,
      delay: data.delay ?? opts.delay ?? 0,
      timestamp: data.timestamp ?? Date.now(),
      attempts: opts.attempts ?? 1,
      parentQueue: data.parent?.queueKey ?? null,
      parentId: data.parent?.id ?? null,
      parentKey: parentKeyOpts?.parentKey ?? data.parentKey ?? null,
      dedupId: data.deduplicationId ?? null,
      schedulerId: data.repeatJobKey ?? null,
      lifo: opts.lifo ?? false,
      addToWaitingChildren: parentKeyOpts?.addToWaitingChildren ?? false,
    };
  }

  async addFlow(
    entries: {
      jobData: JobJson;
      jobId: string;
      parentKeyOpts: ParentKeyOpts;
      prefix: string;
      queueName: string;
    }[],
  ): Promise<[Error | null, string | number][]> {
    // Build an ordered (roots-first) JSON array; the SQL function inserts the
    // whole tree in a single atomic statement. Each entry is self-describing
    // (carries its own queue), so the flow can span multiple queues.
    const payload = entries.map(entry =>
      this.toBatchEntry(
        entry.queueName,
        entry.jobData,
        entry.jobId,
        entry.parentKeyOpts,
      ),
    );

    try {
      const { rows } = await this.run<{ id: string }>('add_flow', [
        JSON.stringify(payload),
      ]);
      // A negative-integer id is an error/skip code (e.g. -5 = missing parent),
      // mirroring the Redis addFlow `[err, idOrCode]` convention; a real job id
      // is a positive counter or a custom string.
      return rows.map(r => {
        const code = Number(r.id);
        return Number.isInteger(code) && code < 0
          ? ([null, code] as [Error | null, number])
          : ([null, r.id] as [Error | null, string]);
      });
    } catch (err) {
      // The single-statement function is atomic: on failure nothing was
      // inserted, so report the same error for every entry.
      return entries.map(() => [err as Error, 0]);
    }
  }

  async addJobScheduler(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    templateOpts: JobsOptions,
    opts: RepeatableOptions,
    delayedJobOpts: JobsOptions,
    producerId?: string,
  ): Promise<[string, number]> {
    let rows: { job_id: string; delay: string }[];
    try {
      ({ rows } = await this.run<{ job_id: string; delay: string }>(
        'add_job_scheduler',
        [
          this.queueName,
          jobSchedulerId,
          nextMillis ?? null,
          templateData || '{}',
          JSON.stringify(templateOpts ?? {}),
          JSON.stringify(opts ?? {}),
          JSON.stringify(delayedJobOpts ?? {}),
          Date.now(),
          producerId ?? null,
        ],
      ));
    } catch (err: any) {
      if (err && err.code === 'BM001') {
        throw finishedErrors({
          code: Number(err.detail),
          command: 'addJobScheduler',
        });
      }
      throw err;
    }
    const row = rows[0];
    return [row.job_id, Number(row.delay)];
  }

  // ============================================================
  // Job state transitions
  // ============================================================

  async moveToActive(token: string, name?: string): Promise<any[]> {
    const opts = this.opts as WorkerOptions;
    const lockDuration = opts.lockDuration ?? 30000;
    const limiterMax = opts.limiter?.max ?? null;
    const limiterDuration = opts.limiter?.duration ?? null;
    const now = Date.now();

    const { rows } = await this.run<JobRow>('move_to_active', [
      this.queueName,
      token,
      lockDuration,
      now,
      name ?? null,
      limiterMax,
      limiterDuration,
    ]);

    return this.buildNextJobResult(rows, limiterMax, now);
  }

  /**
   * Shapes a job-claim result (from `move_to_active` or the fused finish+fetch)
   * into the worker's `[jobData, id, rateLimitDelay, delayUntil]` tuple. When no
   * job was claimed, a follow-up `next_signal` reports the rate-limit ttl or the
   * next delayed wake-up so the worker can block until then.
   */
  private async buildNextJobResult(
    rows: JobRow[],
    limiterMax: number | null,
    now: number,
  ): Promise<any[]> {
    if (rows.length > 0) {
      const row = rows[0];
      // [jobData, id, rateLimitDelay, delayUntil]
      return [rowToJobJson(row), row.id, 0, 0];
    }

    // No job claimed: report the rate-limit ttl (if rate limited) or the next
    // delayed wake-up so the worker can block until then.
    const { rows: sigRows } = await this.run<{
      rate_limit_ttl: string | null;
      next_delay: string | null;
    }>('next_signal', [this.queueName, limiterMax, now]);
    const rateLimitTtl = Number(sigRows[0]?.rate_limit_ttl ?? 0);
    if (rateLimitTtl > 0) {
      return [null, '', rateLimitTtl, 0];
    }
    const delayUntil = bigintOrUndefined(sigRows[0]?.next_delay ?? null) ?? 0;
    return [null, '', 0, delayUntil];
  }

  async moveToCompleted<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    returnValue: R,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext: boolean,
  ): Promise<{ result: void | any[]; finishedOn: number }> {
    const finishedOn = Date.now();
    const keep = normalizeKeep(
      removeOnComplete ?? (this.opts as WorkerOptions).removeOnComplete,
    );
    const opts = this.opts as WorkerOptions;

    // Fast path: fuse the completion and the next-job claim into a single
    // transaction (one commit), the Redis moveToFinished shape. Processing is
    // commit/fsync-bound, so collapsing two commits per job into one is the
    // dominant throughput win.
    if (fetchNext && !this.closing) {
      const lockDuration = opts.lockDuration ?? 30000;
      const limiterMax = opts.limiter?.max ?? null;
      const limiterDuration = opts.limiter?.duration ?? null;
      const now = Date.now();
      let rows: JobRow[] = [];
      try {
        ({ rows } = await this.run<JobRow>('move_to_completed_fetch', [
          this.queueName,
          job.id,
          token,
          JSON.stringify(returnValue ?? null),
          finishedOn,
          keep.removeAll,
          keep.keepAge,
          keep.keepCount,
          lockDuration,
          now,
          this.workerName ?? null,
          limiterMax,
          limiterDuration,
        ]));
      } catch (err) {
        this.mapFinishError(err, job.id, 'moveToFinished');
      }
      await this.collectMetrics('completed', finishedOn);
      const result = await this.buildNextJobResult(rows, limiterMax, now);
      return { result, finishedOn };
    }

    try {
      await this.run('move_to_completed', [
        this.queueName,
        job.id,
        token,
        JSON.stringify(returnValue ?? null),
        finishedOn,
        keep.removeAll,
        keep.keepAge,
        keep.keepCount,
      ]);
    } catch (err) {
      this.mapFinishError(err, job.id, 'moveToFinished');
    }

    await this.collectMetrics('completed', finishedOn);

    return { result: undefined, finishedOn };
  }

  async moveToFailed<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    failedReason: string,
    removeOnFail: boolean | number | KeepJobs,
    token: string,
    fetchNext: boolean,
    fieldsToUpdate?: Record<string, any>,
  ): Promise<{ result: void | any[]; finishedOn: number }> {
    const finishedOn = Date.now();
    const keep = normalizeKeep(
      removeOnFail ?? (this.opts as WorkerOptions).removeOnFail,
    );
    const opts = this.opts as WorkerOptions;

    // Fast path: fuse the failure (or retry re-queue) and the next-job claim
    // into a single transaction (one commit), the Redis moveToFinished shape.
    if (fetchNext && !this.closing) {
      const lockDuration = opts.lockDuration ?? 30000;
      const limiterMax = opts.limiter?.max ?? null;
      const limiterDuration = opts.limiter?.duration ?? null;
      const now = Date.now();
      let rows: JobRow[] = [];
      try {
        ({ rows } = await this.run<JobRow>('move_to_failed_fetch', [
          this.queueName,
          job.id,
          token,
          failedReason,
          fieldsToUpdate?.stacktrace ?? null,
          finishedOn,
          keep.removeAll,
          keep.keepAge,
          keep.keepCount,
          lockDuration,
          now,
          this.workerName ?? null,
          limiterMax,
          limiterDuration,
        ]));
      } catch (err) {
        this.mapFinishError(err, job.id, 'moveToFinished');
      }
      await this.collectMetrics('failed', finishedOn);
      const result = await this.buildNextJobResult(rows, limiterMax, now);
      return { result, finishedOn };
    }

    try {
      await this.run('move_to_failed', [
        this.queueName,
        job.id,
        token,
        failedReason,
        fieldsToUpdate?.stacktrace ?? null,
        finishedOn,
        keep.removeAll,
        keep.keepAge,
        keep.keepCount,
      ]);
    } catch (err) {
      this.mapFinishError(err, job.id, 'moveToFinished');
    }

    await this.collectMetrics('failed', finishedOn);

    return { result: undefined, finishedOn };
  }

  async moveToDelayed(
    jobId: string,
    timestamp: number,
    delay: number,
    token?: string,
    opts?: MoveToDelayedOpts,
  ): Promise<void | any[]> {
    const fields = opts?.fieldsToUpdate ?? {};
    try {
      await this.run('move_to_delayed', [
        this.queueName,
        jobId,
        token ?? '',
        timestamp + delay,
        delay,
        opts?.skipAttempt ?? false,
        fields.failedReason ?? null,
        fields.stacktrace ?? null,
      ]);
    } catch (err) {
      this.mapFinishError(err, jobId, 'moveToDelayed');
    }

    if (opts?.fetchNext && !this.closing && token) {
      const next = await this.moveToActive(token, this.workerName);
      // Return the next job tuple only when a job was actually claimed;
      // otherwise an empty array (a delay hint is not "next job data").
      return next && next[0] ? next : [];
    }
    return [];
  }

  async moveToWaitingChildren(
    jobId: string,
    token: string,
    _opts?: MoveToWaitingChildrenOpts,
  ): Promise<boolean> {
    let rows: { code: number }[];
    try {
      ({ rows } = await this.run<{ code: number }>('move_to_waiting_children', [
        this.queueName,
        jobId,
        token,
      ]));
    } catch (err: any) {
      this.mapFinishError(err, jobId, 'moveToWaitingChildren');
    }
    const code = rows[0].code;
    if (code < 0) {
      throw finishedErrors({
        code,
        jobId,
        command: 'moveToWaitingChildren',
        state: 'active',
      });
    }
    // 1 = moved to waiting-children (should wait); 0 = no pending, proceed.
    return code === 1;
  }

  async moveJobFromActiveToWait(jobId: string, token = '0'): Promise<number> {
    const { rows } = await this.run<{ n: number }>('move_active_to_wait', [
      this.queueName,
      jobId,
      token,
      Date.now(),
    ]);
    const n = Number(rows[0].n);
    if (n < 0) {
      throw finishedErrors({
        code: n,
        jobId,
        command: 'moveJobFromActiveToWait',
      });
    }
    return n;
  }

  async retryJob(
    jobId: string,
    lifo: boolean,
    token?: string,
    opts?: RetryJobOpts,
  ): Promise<void> {
    const fields = opts?.fieldsToUpdate ?? {};
    try {
      await this.run('retry_job', [
        this.queueName,
        jobId,
        token ?? '',
        lifo,
        fields.failedReason ?? null,
        fields.stacktrace ?? null,
      ]);
    } catch (err) {
      this.mapFinishError(err, jobId, 'retryJob');
    }
  }

  async retryFinishedJob<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    state: 'failed' | 'completed',
    opts: RetryOptions = {},
  ): Promise<void> {
    const { rows } = await this.run<{ code: number }>('reprocess_job', [
      this.queueName,
      job.id,
      state,
      job.opts?.lifo ?? false,
      opts.resetAttemptsMade ?? false,
      opts.resetAttemptsStarted ?? false,
    ]);
    const code = rows[0].code;
    if (code !== 1) {
      throw finishedErrors({
        code,
        jobId: job.id,
        command: 'reprocessJob',
        state,
      });
    }
  }

  async promote(jobId: string): Promise<void> {
    const { rows } = await this.run<{ code: number }>('promote', [
      this.queueName,
      jobId,
    ]);
    const code = rows[0].code;
    if (code < 0) {
      throw finishedErrors({
        code,
        jobId,
        command: 'promote',
        state: 'delayed',
      });
    }
  }

  async moveStalledJobsToWait(): Promise<string[]> {
    // Recover active jobs whose lock expired: push them back to waiting so a
    // worker can re-claim them. Returns the recovered job ids. Uses a two-phase
    // mark/sweep so a freshly-claimed job is never reclaimed mid-processing.
    const opts = this.opts as WorkerOptions;
    const { rows } = await this.run<{ id: string }>(
      'move_stalled_jobs_to_wait',
      [
        this.queueName,
        opts.maxStalledCount ?? 1,
        Date.now(),
        opts.stalledInterval ?? 30000,
      ],
    );
    return rows.map(r => r.id);
  }

  // ============================================================
  // Bulk admin transitions
  // ============================================================

  async retryFinishedJobs(
    state?: FinishedStatus,
    count?: number,
    timestamp?: number,
  ): Promise<number> {
    const { rows } = await this.run<{ n: string }>('retry_jobs', [
      this.queueName,
      state ?? 'failed',
      count ?? null,
      timestamp ?? null,
    ]);
    return Number(rows[0].n);
  }

  async promoteJobs(count?: number): Promise<number> {
    const { rows } = await this.run<{ n: string }>('promote_jobs', [
      this.queueName,
      count ?? null,
    ]);
    return Number(rows[0].n);
  }

  async pause(pause: boolean): Promise<void> {
    await this.run('pause', [this.queueName, pause]);
  }

  async drain(delayed: boolean): Promise<void> {
    await this.run('drain', [this.queueName, delayed]);
  }

  async cleanJobsByState(
    state: string,
    timestamp: number,
    limit = 0,
  ): Promise<string[]> {
    const { rows } = await this.run<{ id: string }>('clean', [
      this.queueName,
      state,
      timestamp,
      limit,
    ]);
    return rows.map(r => r.id);
  }

  async obliterate(opts: { force: boolean; count: number }): Promise<number> {
    const { rows } = await this.run<{ cursor: number }>('obliterate', [
      this.queueName,
      opts.count,
      opts.force,
    ]);
    const cursor = Number(rows[0].cursor);
    if (cursor < 0) {
      switch (cursor) {
        case -1:
          throw new Error('Cannot obliterate non-paused queue');
        case -2:
          throw new Error('Cannot obliterate queue with active jobs');
      }
    }
    return cursor;
  }

  /**
   * Removes orphaned job hashes (job data present but not referenced by any
   * state set). This is a Redis keyspace-maintenance concern: on PostgreSQL a
   * job is a single relational row inserted transactionally with its state, so
   * orphans cannot exist and there is nothing to remove. Always returns 0.
   */
  removeOrphanedJobs(_count?: number, _limit?: number): Promise<number> {
    return Promise.resolve(0);
  }

  // ============================================================
  // Locks
  // ============================================================

  async extendLock(
    jobId: string,
    token: string,
    duration: number,
  ): Promise<number> {
    const { rows } = await this.run<{ n: number }>('extend_lock', [
      this.queueName,
      jobId,
      token,
      duration,
      Date.now(),
    ]);
    return rows[0].n;
  }

  async extendLocks(
    jobIds: string[],
    tokens: string[],
    duration: number,
  ): Promise<string[]> {
    // Returns the ids whose lock could NOT be extended.
    const failed: string[] = [];
    for (let i = 0; i < jobIds.length; i++) {
      const ok = await this.extendLock(jobIds[i], tokens[i], duration);
      if (!ok) {
        failed.push(jobIds[i]);
      }
    }
    return failed;
  }

  // ============================================================
  // Job mutations
  // ============================================================

  async updateData<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    data: T,
  ): Promise<void> {
    const { rows } = await this.run<{ id: string }>('update_data', [
      this.queueName,
      job.id,
      JSON.stringify(data ?? {}),
    ]);
    if (rows.length === 0) {
      throw finishedErrors({
        code: -1,
        jobId: job.id,
        command: 'updateData',
      });
    }
  }

  async updateProgress(jobId: string, progress: JobProgress): Promise<void> {
    const { rows } = await this.run<{ updated: number }>('update_progress', [
      this.queueName,
      jobId,
      JSON.stringify(progress ?? null),
    ]);
    if (!rows[0].updated) {
      throw finishedErrors({
        code: -1,
        jobId,
        command: 'updateProgress',
      });
    }
  }

  async addLog(
    jobId: string,
    logRow: string,
    keepLogs?: number,
  ): Promise<number> {
    let rows: { idx: string }[];
    try {
      ({ rows } = await this.run<{ idx: string }>('add_log', [
        this.queueName,
        jobId,
        logRow,
      ]));
    } catch (err: any) {
      // 23503 = foreign_key_violation: the job no longer exists.
      if (err && err.code === '23503') {
        throw finishedErrors({ code: -1, jobId, command: 'addLog' });
      }
      throw err;
    }
    const count = Number(rows[0].idx) + 1;

    if (keepLogs && count > keepLogs) {
      await this.run('trim_logs', [this.queueName, jobId, count - keepLogs]);
      return keepLogs;
    }

    return count;
  }

  async clearLogs(jobId: string, keepLogs?: number): Promise<void> {
    await this.run('clear_logs', [this.queueName, jobId, keepLogs ?? null]);
  }

  async changeDelay(jobId: string, delay: number): Promise<void> {
    const { rows } = await this.run<{ code: number }>('change_delay', [
      this.queueName,
      jobId,
      delay,
      Date.now(),
    ]);
    const code = rows[0].code;
    if (code < 0) {
      throw finishedErrors({
        code,
        jobId,
        command: 'changeDelay',
        state: 'delayed',
      });
    }
  }

  async changePriority(
    jobId: string,
    priority = 0,
    lifo = false,
  ): Promise<void> {
    const { rows } = await this.run<{ code: number }>('change_priority', [
      this.queueName,
      jobId,
      priority,
      lifo,
    ]);
    const code = rows[0].code;
    if (code < 0) {
      throw finishedErrors({ code, jobId, command: 'changePriority' });
    }
  }

  async remove(jobId: string, removeChildren: boolean): Promise<number> {
    let rows: { n: number }[];
    try {
      ({ rows } = await this.run<{ n: number }>('remove', [
        this.queueName,
        jobId,
        removeChildren,
      ]));
    } catch (err: any) {
      if (err && err.code === 'BM001') {
        throw finishedErrors({
          code: Number(err.detail),
          jobId,
          command: 'remove',
        });
      }
      throw err;
    }
    return rows[0].n;
  }

  async removeUnprocessedChildren(jobId: string): Promise<void> {
    await this.run('remove_unprocessed_children', [this.queueName, jobId]);
  }

  async removeChildDependency(
    jobId: string,
    parentKey: string,
  ): Promise<boolean> {
    try {
      const { rows } = await this.run<{ n: number }>(
        'remove_child_dependency',
        [this.queueName, jobId, parentKey, Date.now()],
      );
      return rows[0].n === 0;
    } catch (err: any) {
      if (err && err.code === 'BM001') {
        throw finishedErrors({
          code: Number(err.detail),
          jobId,
          parentKey,
          command: 'removeChildDependency',
        });
      }
      throw err;
    }
  }

  async removeDeduplicationKey(
    deduplicationId: string,
    jobId: string,
  ): Promise<number> {
    const { rows } = await this.run<{ dedup_id: string }>(
      'remove_deduplication_key',
      [this.queueName, deduplicationId, jobId, Date.now()],
    );
    return rows.length;
  }

  async deleteDeduplicationKey(deduplicationId: string): Promise<number> {
    const { rows } = await this.run<{ dedup_id: string }>(
      'delete_deduplication_key',
      [this.queueName, deduplicationId],
    );
    return rows.length;
  }

  // ============================================================
  // Job schedulers
  // ============================================================

  async updateJobSchedulerNextMillis(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    delayedJobOpts: JobsOptions,
    producerId?: string,
  ): Promise<string | null> {
    const { rows } = await this.run<{ job_id: string | null }>(
      'update_job_scheduler',
      [
        this.queueName,
        jobSchedulerId,
        nextMillis ?? null,
        templateData || '{}',
        JSON.stringify(delayedJobOpts ?? {}),
        Date.now(),
        producerId ?? null,
      ],
    );
    return rows[0]?.job_id ?? null;
  }

  async removeJobScheduler(jobSchedulerId: string): Promise<number> {
    const { rows } = await this.run<{ removed: number }>(
      'remove_job_scheduler',
      [this.queueName, jobSchedulerId],
    );
    return rows[0]?.removed ?? 0;
  }

  async getJobScheduler(id: string): Promise<[any, string | null]> {
    const { rows } = await this.run<SchedulerRow>('get_job_scheduler', [
      this.queueName,
      id,
    ]);
    if (rows.length === 0) {
      return [null, null];
    }
    const { hash, next } = mapSchedulerRow(rows[0]);
    const flat: string[] = [];
    for (const [k, v] of Object.entries(hash)) {
      flat.push(k, v);
    }
    return [flat, next];
  }

  async isJobScheduler(id: string): Promise<boolean> {
    const { rows } = await this.run<{ exists: boolean }>('is_job_scheduler', [
      this.queueName,
      id,
    ]);
    return rows[0]?.exists ?? false;
  }

  async getJobSchedulerData(key: string): Promise<Record<string, string>> {
    const { rows } = await this.run<SchedulerRow>('get_job_scheduler', [
      this.queueName,
      key,
    ]);
    if (rows.length === 0) {
      return {};
    }
    return mapSchedulerRow(rows[0]).hash;
  }

  async getJobSchedulersRange(
    start: number,
    end: number,
    asc: boolean,
  ): Promise<string[]> {
    const count = end < 0 ? null : end - start + 1;
    const { rows } = await this.run<{
      scheduler_id: string;
      next_run_ms: string;
    }>('get_job_schedulers_range', [this.queueName, asc, start, count]);
    const flat: string[] = [];
    for (const r of rows) {
      flat.push(r.scheduler_id, String(r.next_run_ms));
    }
    return flat;
  }

  async getJobSchedulersCount(): Promise<number> {
    const { rows } = await this.run<{ count: number }>(
      'get_job_schedulers_count',
      [this.queueName],
    );
    return rows[0]?.count ?? 0;
  }

  // ============================================================
  // Queue / job queries
  // ============================================================

  async getState(jobId: string): Promise<JobState | 'unknown'> {
    const { rows } = await this.run<{ state: string; priority: number }>(
      'get_state',
      [this.queueName, jobId],
    );
    if (!rows[0]) {
      return 'unknown';
    }
    // A prioritized job is a waiting job with priority > 0.
    if (rows[0].state === 'waiting' && rows[0].priority > 0) {
      return 'prioritized';
    }
    return rows[0].state as JobState;
  }

  async isFinished(
    jobId: string,
    returnValue?: boolean,
  ): Promise<number | [number, string]> {
    const { rows } = await this.run<{
      state: string;
      return_value: any;
      failed_reason: string | null;
    }>('is_finished', [this.queueName, jobId]);
    const row = rows[0];

    // status: 0 = not finished, 1 = completed, 2 = failed, -1 = missing job.
    let status = 0;
    let value = '';
    if (!row) {
      status = -1;
      value = `Missing key for job ${this.toKey(jobId)}. isFinished`;
    } else if (row.state === 'completed') {
      status = 1;
      value = JSON.stringify(row.return_value ?? null);
    } else if (row.state === 'failed') {
      status = 2;
      value = row.failed_reason ?? '';
    }
    return returnValue ? [status, value] : status;
  }

  async isMaxed(): Promise<boolean> {
    const { rows } = await this.run<{ maxed: boolean }>('is_maxed', [
      this.queueName,
    ]);
    return rows[0].maxed;
  }

  async isJobInQueueState(state: string, jobId: string): Promise<boolean> {
    if (state === 'active') {
      const { rows } = await this.run<{ present: boolean }>('is_job_in_state', [
        this.queueName,
        jobId,
        'active',
      ]);
      return rows[0].present;
    }
    // 'wait' or 'paused' — distinguished by the queue's paused flag.
    const { rows } = await this.run<{ present: boolean }>('is_job_in_wait', [
      this.queueName,
      jobId,
      state === 'paused',
    ]);
    return rows[0].present;
  }

  async isJobInScoredState(state: string, jobId: string): Promise<boolean> {
    if (state === 'prioritized') {
      const { rows } = await this.run<{ present: boolean }>(
        'is_job_prioritized',
        [this.queueName, jobId],
      );
      return rows[0].present;
    }
    const { rows } = await this.run<{ present: boolean }>('is_job_in_state', [
      this.queueName,
      jobId,
      state,
    ]);
    return rows[0].present;
  }

  async getJobData(jobId: string): Promise<JobJson | undefined> {
    const { rows } = await this.run<JobRow>('get_job_data', [
      this.queueName,
      jobId,
    ]);
    return rows[0] ? rowToJobJson(rows[0]) : undefined;
  }

  async getDeduplicationJobId(deduplicationId: string): Promise<string | null> {
    const { rows } = await this.run<{ job_id: string }>(
      'get_deduplication_job_id',
      [this.queueName, deduplicationId, Date.now()],
    );
    return rows[0]?.job_id ?? null;
  }

  async getJobLogs(
    jobId: string,
    start: number,
    end: number,
    asc: boolean,
  ): Promise<{ logs: string[]; count: number }> {
    const { rows: countRows } = await this.run<{ count: string }>(
      'get_job_logs_count',
      [this.queueName, jobId],
    );
    const count = Number(countRows[0].count);

    // start/end are inclusive zero-based indexes (Redis LRANGE semantics).
    const from = start < 0 ? Math.max(count + start, 0) : start;
    const to = end < 0 ? count + end : end;
    const limit = to - from + 1;
    if (limit <= 0) {
      return { logs: [], count };
    }

    const { rows } = await this.run<{ row: string }>(
      asc ? 'get_job_logs_asc' : 'get_job_logs_desc',
      [this.queueName, jobId, from, limit],
    );
    return { logs: rows.map(r => r.row), count };
  }

  async getRateLimitTtl(maxJobs?: number): Promise<number> {
    // Mirrors getRateLimitTtl-2.lua: explicit maxJobs → check against it; else
    // the global meta `max`; else the raw window ttl (-2 when none).
    const { rows } = await this.run<{ ttl: string }>('get_rate_limit_ttl', [
      this.queueName,
      maxJobs ?? 0,
      Date.now(),
    ]);
    return Number(rows[0].ttl);
  }

  async getCounts(types: JobType[]): Promise<number[]> {
    const { rows } = await this.run<Record<string, string>>('get_counts', [
      this.queueName,
    ]);
    const counts = rows[0];
    const waiting = Number(counts.waiting);
    const prioritized = Number(counts.prioritized);
    const isPaused = counts.paused === '1';

    const lookup: Record<string, number> = {
      active: Number(counts.active),
      completed: Number(counts.completed),
      failed: Number(counts.failed),
      delayed: Number(counts.delayed),
      // When paused, waiting jobs are reported as paused (the queue isn't
      // physically moving them — see the O(1) pause flag).
      wait: isPaused ? 0 : waiting,
      waiting: isPaused ? 0 : waiting,
      prioritized,
      'waiting-children': Number(counts['waiting-children']),
      paused: isPaused ? waiting : 0,
    };
    return types.map(type => lookup[type] ?? 0);
  }

  async getCountsPerPriority(priorities: number[]): Promise<number[]> {
    const { rows } = await this.run<{ cnt: string }>(
      'get_counts_per_priority',
      [this.queueName, priorities],
    );
    return rows.map(r => Number(r.cnt));
  }

  async getRanges(
    types: JobType[],
    start = 0,
    end = -1,
    asc = false,
  ): Promise<[string][]> {
    const result: string[][] = [];
    for (const type of types) {
      const { rows } = await this.run<{ id: string }>('get_range', [
        this.queueName,
        type,
        start,
        end,
        asc,
      ]);
      result.push(rows.map(r => r.id));
    }
    return result as unknown as [string][];
  }

  async getDependencyCounts(jobId: string, types: string[]): Promise<number[]> {
    const { rows } = await this.run<{
      processed: string;
      unprocessed: string;
      ignored: string;
      failed: string;
    }>('get_dependency_counts', [this.queueName, jobId]);
    const c = rows[0];
    const map: Record<string, number> = {
      processed: Number(c.processed),
      unprocessed: Number(c.unprocessed),
      ignored: Number(c.ignored),
      failed: Number(c.failed),
    };
    return types.map(t => map[t] ?? 0);
  }

  async getDependencies(
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
  }> {
    // No category requested: return all four in full (mirrors the Redis
    // hgetall/smembers path). `value` for processed/ignored comes back as a
    // parsed JSON value from jsonb.
    if (!opts.processed && !opts.unprocessed && !opts.ignored && !opts.failed) {
      const { rows } = await this.run<{
        status: string;
        child_key: string;
        value: any;
      }>('get_dependencies', [this.queueName, jobId]);
      const processed: Record<string, any> = {};
      const unprocessed: string[] = [];
      const ignored: Record<string, any> = {};
      const failed: string[] = [];
      for (const r of rows) {
        switch (r.status) {
          case 'processed':
            processed[r.child_key] = r.value;
            break;
          case 'pending':
            unprocessed.push(r.child_key);
            break;
          case 'ignored':
            ignored[r.child_key] = r.value;
            break;
          case 'failed':
            failed.push(r.child_key);
            break;
        }
      }
      return { processed, unprocessed, ignored, failed };
    }

    // Paginated per requested category (cursor is a plain offset here).
    const result: {
      nextFailedCursor?: number;
      failed?: string[];
      nextIgnoredCursor?: number;
      ignored?: Record<string, any>;
      nextProcessedCursor?: number;
      processed?: Record<string, any>;
      nextUnprocessedCursor?: number;
      unprocessed?: string[];
    } = {};
    const page = async (
      status: string,
      cursor = 0,
      count = 20,
    ): Promise<{ rows: { child_key: string; value: any }[]; next: number }> => {
      const { rows } = await this.run<{ child_key: string; value: any }>(
        'get_dependencies_page',
        [this.queueName, jobId, status, cursor, count],
      );
      return { rows, next: rows.length < count ? 0 : cursor + count };
    };
    if (opts.processed) {
      const { rows, next } = await page(
        'processed',
        opts.processed.cursor,
        opts.processed.count,
      );
      const processed: Record<string, any> = {};
      for (const r of rows) {
        processed[r.child_key] = r.value;
      }
      result.processed = processed;
      result.nextProcessedCursor = next;
    }
    if (opts.unprocessed) {
      const { rows, next } = await page(
        'pending',
        opts.unprocessed.cursor,
        opts.unprocessed.count,
      );
      result.unprocessed = rows.map(r => r.child_key);
      result.nextUnprocessedCursor = next;
    }
    if (opts.ignored) {
      const { rows, next } = await page(
        'ignored',
        opts.ignored.cursor,
        opts.ignored.count,
      );
      const ignored: Record<string, any> = {};
      for (const r of rows) {
        ignored[r.child_key] = r.value;
      }
      result.ignored = ignored;
      result.nextIgnoredCursor = next;
    }
    if (opts.failed) {
      const { rows, next } = await page(
        'failed',
        opts.failed.cursor,
        opts.failed.count,
      );
      result.failed = rows.map(r => r.child_key);
      result.nextFailedCursor = next;
    }
    return result;
  }

  async getProcessedChildrenValues(
    jobId: string,
  ): Promise<Record<string, string>> {
    const { rows } = await this.run<{ child_key: string; value: string }>(
      'get_processed_children_values',
      [this.queueName, jobId],
    );
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.child_key] = r.value;
    }
    return result;
  }

  async getIgnoredChildrenFailures(
    jobId: string,
  ): Promise<Record<string, string>> {
    const { rows } = await this.run<{ child_key: string; reason: string }>(
      'get_ignored_children_failures',
      [this.queueName, jobId],
    );
    const result: Record<string, string> = {};
    for (const r of rows) {
      result[r.child_key] = r.reason;
    }
    return result;
  }

  /**
   * Records one finished job into the per-minute metrics for the given `kind`,
   * when the worker was created with a `metrics.maxDataPoints`. Mirrors the
   * `collectMetrics` step of Redis's moveToFinished; kept as a separate query
   * (metrics are best-effort, so strict atomicity with the finish is not
   * required).
   */
  private async collectMetrics(
    kind: 'completed' | 'failed',
    finishedOn: number,
  ): Promise<void> {
    const maxDataPoints = (this.opts as WorkerOptions).metrics?.maxDataPoints;
    if (maxDataPoints) {
      await this.run('collect_metrics', [
        this.queueName,
        kind,
        maxDataPoints,
        finishedOn,
      ]);
    }
  }

  async getMetrics(
    type: 'completed' | 'failed',
    start = 0,
    end = -1,
  ): Promise<[string[], string[], number]> {
    const { rows } = await this.run<{ total: string; data: string[] }>(
      'get_metrics',
      [this.queueName, type, start, end],
    );
    const total = rows[0]?.total ?? '0';
    const data = (rows[0]?.data ?? []).map(String);
    // [meta, data, count] mirrors getMetrics-1.lua: meta = [count, prevTS,
    // prevCount] (only the cumulative count is tracked here), data = the sliced
    // per-minute points, count = number of points returned.
    return [[total, '0', '0'], data, data.length];
  }

  async getClientList(): Promise<string[]> {
    // Mirror Redis CLIENT LIST using pg_stat_activity: each named session
    // (workers / QueueEvents set their `application_name`) becomes a
    // `name=<application_name>` line, which the shared client-list parser then
    // matches against the queue's client name. Returned as a single-element
    // array since PostgreSQL has no cluster-node fan-out.
    const { rows } = await this.run<{ application_name: string }>(
      'get_client_list',
    );
    return [rows.map(r => `name=${r.application_name}`).join('\n')];
  }

  async paginate(
    key: string,
    opts: { start: number; end: number; fetchJobs?: boolean },
  ): Promise<{
    cursor: string;
    items: { id: string; v?: any; err?: string }[];
    total: number;
    jobs?: JobJson[];
  }> {
    // The dependency getters page over a parent's children: the key is
    // `<queue>:<parentId>:dependencies` (pending children) or
    // `<queue>:<parentId>:processed` (resolved children, carrying their value).
    const prefix = `${this.queueName}:`;
    const inner = key.startsWith(prefix) ? key.slice(prefix.length) : key;
    let status: 'pending' | 'processed';
    let parentId: string;
    let withValue = false;
    if (inner.endsWith(':processed')) {
      status = 'processed';
      withValue = true;
      parentId = inner.slice(0, -':processed'.length);
    } else if (inner.endsWith(':dependencies')) {
      status = 'pending';
      parentId = inner.slice(0, -':dependencies'.length);
    } else {
      // Only the dependency / processed pagination keys are supported.
      return notImplemented('paginate');
    }

    const offset = Math.max(opts.start ?? 0, 0);
    const limit =
      opts.end != null && opts.end >= 0 ? opts.end - offset + 1 : null;

    const { rows } = await this.run<
      JobRow & { child_key: string; dep_value: unknown; total: string }
    >('paginate_dependencies', [
      this.queueName,
      parentId,
      status,
      offset,
      limit,
    ]);

    const total = rows.length ? Number(rows[0].total) : 0;
    const items = rows.map(r =>
      withValue ? { id: r.child_key, v: r.dep_value } : { id: r.child_key },
    );
    const jobs = opts.fetchJobs
      ? rows.filter(r => r.id != null).map(r => rowToJobJson(r))
      : undefined;

    return { cursor: '0', items, total, jobs };
  }

  // ============================================================
  // Queue metadata & maintenance keys
  // ============================================================

  async setQueueMeta(values: Record<string, string | number>): Promise<number> {
    const fields = Object.keys(values);
    if (fields.length === 0) {
      return 0;
    }
    const vals = fields.map(f => String(values[f]));
    const { rowCount } = await this.run('set_queue_meta', [
      this.queueName,
      fields,
      vals,
    ]);
    return rowCount ?? fields.length;
  }

  async getQueueMetaField(field: string): Promise<string | null> {
    const { rows } = await this.run<{ value: string | null }>(
      'get_queue_meta_field',
      [this.queueName, field],
    );
    return rows[0]?.value ?? null;
  }

  async getQueueMetaFields(fields: string[]): Promise<(string | null)[]> {
    if (fields.length === 0) {
      return [];
    }
    const { rows } = await this.run<{ field: string; value: string | null }>(
      'get_queue_meta_fields',
      [this.queueName, fields],
    );
    const map = new Map(rows.map(r => [r.field, r.value]));
    return fields.map(f => map.get(f) ?? null);
  }

  async getQueueMeta(): Promise<Record<string, string>> {
    const { rows } = await this.run<{ field: string; value: string }>(
      'get_queue_meta',
      [this.queueName],
    );
    const meta: Record<string, string> = {};
    for (const r of rows) {
      meta[r.field] = r.value;
    }
    return meta;
  }

  async removeQueueMetaFields(fields: string[]): Promise<number> {
    if (fields.length === 0) {
      return 0;
    }
    const { rowCount } = await this.run('remove_queue_meta_fields', [
      this.queueName,
      fields,
    ]);
    return rowCount ?? 0;
  }

  async hasQueueMetaField(field: string): Promise<boolean> {
    const { rows } = await this.run<{ exists: boolean }>(
      'has_queue_meta_field',
      [this.queueName, field],
    );
    return rows[0].exists;
  }

  async setRateLimit(expireTimeMs: number): Promise<void> {
    // Force the limiter window (mirrors Redis SET limiter=MAX PX expireTimeMs).
    await this.run('set_rate_limit', [
      this.queueName,
      expireTimeMs,
      Date.now(),
    ]);
  }

  async removeRateLimitKey(): Promise<number> {
    const { rows } = await this.run<{ n: number }>('remove_rate_limit', [
      this.queueName,
    ]);
    return rows[0].n;
  }

  removeDeprecatedPriorityKey(): Promise<number> {
    return notImplemented('removeDeprecatedPriorityKey');
  }

  trimEvents(_maxLength: number): Promise<number> {
    return notImplemented('trimEvents');
  }

  // ============================================================
  // Event stream
  // ============================================================

  async publishEvent(
    fields: Record<string, string | number>,
    _maxEvents: number,
  ): Promise<string> {
    const { event, ...rest } = fields;
    const { rows } = await this.run<{ id: string }>('publish_event', [
      this.queueName,
      String(event),
      JSON.stringify(rest),
    ]);
    return String(rows[0].id);
  }

  async readEvents(id: string, blockTimeout: number): Promise<StreamReadRaw> {
    if (this.closing || this.connection.isClosing) {
      return null as unknown as StreamReadRaw;
    }
    // Resolve the cursor: '$' means "only events from now on".
    let cursor: string;
    if (id === '$') {
      const { rows } = await this.run<{ max: string }>('read_events_max', [
        this.queueName,
      ]);
      cursor = rows[0].max;
    } else {
      cursor = id;
    }

    let events = await this.fetchEvents(cursor);
    if (events.length === 0) {
      await this.waitForEvent(blockTimeout);
      if (this.closing || this.connection.isClosing) {
        return null as unknown as StreamReadRaw;
      }
      events = await this.fetchEvents(cursor);
    }
    if (events.length === 0) {
      return null as unknown as StreamReadRaw;
    }

    // Redis XREAD shape: [[streamKey, [[id, [k1,v1,...]], ...]]].
    return [
      ['events', events.map(e => [e.id, e.fields] as [string, string[]])],
    ] as unknown as StreamReadRaw;
  }

  private async fetchEvents(
    cursor: string,
  ): Promise<{ id: string; fields: string[] }[]> {
    const { rows } = await this.run<{ id: string; event: string; data: any }>(
      'read_events',
      [this.queueName, cursor, EVENT_READ_BATCH],
    );
    return rows.map(r => {
      const fields: string[] = ['event', r.event];
      for (const [k, v] of Object.entries(r.data ?? {})) {
        fields.push(k, typeof v === 'string' ? v : String(v));
      }
      return { id: String(r.id), fields };
    });
  }

  // ============================================================
  // Worker blocking primitive
  // ============================================================

  /** The shared notify channel all producers post to (see `bullmq_add_job`). */
  private static readonly NOTIFY_CHANNEL = 'bullmq_jobs';

  /** The shared event-stream channel (see `bullmq_publish_event`). */
  private static readonly EVENTS_CHANNEL = 'bullmq_events';

  /** Subscribes the dedicated client to the shared jobs channel (once). */
  private async ensureListening(): Promise<PgListenClient> {
    const client = await this.connection.getListenClient();
    if (!this.listening) {
      await client.query(loadCommandSql('listen_jobs'));
      this.listening = true;
    }
    return client;
  }

  /** Subscribes the dedicated client to the shared events channel (once). */
  private async ensureListeningEvents(): Promise<PgListenClient> {
    const client = await this.connection.getListenClient();
    if (!this.listeningEvents) {
      await client.query(loadCommandSql('listen_events'));
      this.listeningEvents = true;
    }
    return client;
  }

  /**
   * Blocks (up to `blockTimeout` ms) until a new event is published for this
   * queue (via `LISTEN`/`NOTIFY` on the events channel), or the timeout
   * elapses. Used by {@link readEvents} between polls.
   */
  private async waitForEvent(blockTimeout: number): Promise<void> {
    if (this.closing || this.connection.isClosing) {
      return;
    }
    const client = await this.ensureListeningEvents();

    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        client.removeListener('notification', onNotify);
        this.cancelEventWait = undefined;
        resolve();
      };
      const onNotify = (msg: PgNotification) => {
        if (
          msg.channel === PostgresQueueBackend.EVENTS_CHANNEL &&
          msg.payload === this.queueName
        ) {
          finish();
        }
      };
      const timer = setTimeout(finish, Math.max(blockTimeout || 5000, 1));
      this.cancelEventWait = finish;
      client.on('notification', onNotify);
    });
  }

  /**
   * Blocks (up to `blockTimeout` seconds) until a job for this queue may be
   * available, via `LISTEN`/`NOTIFY`. Producers notify the shared `bullmq_jobs`
   * channel with the queue name as payload (in `bullmq_add_job`), so a producer
   * in any process wakes a blocked worker immediately. Returns a marker
   * (`score` 0 = "check now") or `null` on timeout. The Redis backend
   * implements this with `BZPOPMIN`.
   */
  async waitForJob(
    blockTimeout: number,
  ): Promise<{ member: string; score: number } | null> {
    if (this.closing || this.blockingDisconnected) {
      return null;
    }
    const client = await this.ensureListening();

    // The blocking connection may have been torn down while we were awaiting
    // `ensureListening`; bail rather than registering a wait that only a
    // (possibly faked) timer could end.
    if (this.closing || this.blockingDisconnected) {
      return null;
    }

    return new Promise(resolve => {
      let settled = false;
      const finish = (value: { member: string; score: number } | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        client.removeListener('notification', onNotify);
        this.cancelWait = undefined;
        resolve(value);
      };

      const onNotify = (msg: PgNotification) => {
        // Filter for this queue (the shared channel carries every queue).
        if (
          msg.channel === PostgresQueueBackend.NOTIFY_CHANNEL &&
          msg.payload === this.queueName
        ) {
          finish({ member: msg.payload ?? '', score: 0 });
        }
      };

      let timer = setTimeout(
        () => finish(null),
        Math.max(blockTimeout, 0) * 1000,
      );

      this.cancelWait = () => finish(null);
      client.on('notification', onNotify);

      // Final race guard: if `disconnectBlocking` ran between the check above
      // and installing `cancelWait`, end the wait now instead of blocking on a
      // timer (which never fires under faked timers).
      if (this.blockingDisconnected) {
        finish(null);
        return;
      }

      // Close the race (and survive a NOTIFY that fired before we subscribed):
      // with the listener already registered above, check whether a claimable
      // job is already waiting and, if so, wake immediately. This mirrors the
      // check-and-block atomicity of Redis's blocking pop and avoids relying on
      // a (possibly faked) timeout to recover a missed notification.
      this.run<{ present: boolean }>('has_waiting_job', [this.queueName])
        .then(({ rows }) => {
          if (rows[0]?.present) {
            finish({ member: this.queueName, score: 0 });
          }
        })
        .catch(() => {
          // Ignore: a failed probe just falls back to the notify/timeout wait.
        });

      // Shorten the wait to the next due delayed job: a delayed job's promotion
      // is not announced by a NOTIFY at its due time, so without this the worker
      // would sleep the full `blockTimeout` (drainDelay) before re-checking.
      this.run<{ next_delay: string | null }>('next_delay', [this.queueName])
        .then(({ rows }) => {
          const next = bigintOrUndefined(rows[0]?.next_delay ?? null);
          if (next === undefined || settled) {
            return;
          }
          const dueIn = next - Date.now();
          if (dueIn <= 0) {
            // The delayed job is already due (its due time passed while this
            // probe was in flight — e.g. the clock advanced meanwhile). Wake
            // now instead of arming a 0ms timer: under faked timers a 0ms
            // timeout never fires unless the clock is advanced again, which
            // would only happen once a job is processed — a deadlock.
            finish(null);
          } else if (dueIn < Math.max(blockTimeout, 0) * 1000) {
            clearTimeout(timer);
            timer = setTimeout(() => finish(null), dueIn);
          }
        })
        .catch(() => {
          // Ignore: fall back to the notify/timeout wait.
        });
    });
  }

  async disconnectBlocking(_wait = true): Promise<void> {
    this.blockingDisconnected = true;
    this.cancelWait?.();
  }

  async reconnectBlocking(): Promise<void> {
    // Allow the blocking wait to run again and force a fresh LISTEN on the next
    // waitForJob (e.g. after a reconnect).
    this.blockingDisconnected = false;
    this.listening = false;
  }
}
