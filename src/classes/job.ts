import { debuglog } from 'util';
import {
  BackoffOptions,
  BulkJobOptions,
  DependenciesOpts,
  IRedisTransaction,
  IQueueBackend,
  JobJson,
  MinimalJob,
  MinimalQueue,
  MoveToWaitingChildrenOpts,
  ParentKeys,
  ParentKeyOpts,
  RedisClient,
  RetryOptions,
  WorkerOptions,
  Span,
} from '../interfaces';
import {
  FinishedStatus,
  JobsOptions,
  JobState,
  JobJsonSandbox,
  JobProgress,
} from '../types';
import {
  errorObject,
  getParentKey,
  lengthInUtf8Bytes,
  optsDecodeMap,
  parseObjectValues,
  tryCatch,
  removeUndefinedFields,
} from '../utils';
import { Backoffs } from './backoffs';
import { RedisQueueBackend } from './redis-queue-backend';
import { UnrecoverableError } from './errors/unrecoverable-error';
import type { QueueEvents } from './queue-events';
import { SpanKind, TelemetryAttributes, MetricNames } from '../enums';

const logger = debuglog('bull');

export const PRIORITY_LIMIT = 2 ** 21;

/**
 * Job
 *
 * This class represents a Job in the queue. Normally job are implicitly created when
 * you add a job to the queue with methods such as Queue.addJob( ... )
 *
 * A Job instance is also passed to the Worker's process function.
 *
 */
export class Job<
  DataType = any,
  ReturnType = any,
  NameType extends string = string,
> implements MinimalJob<DataType, ReturnType, NameType> {
  /**
   * It includes the prefix, the namespace separator :, and queue name.
   * @see {@link https://www.gnu.org/software/gawk/manual/html_node/Qualified-Names.html}
   */
  public readonly queueQualifiedName: string;

  /**
   * The progress a job has performed so far.
   * @defaultValue 0
   */
  progress: JobProgress = 0;

  /**
   * The value returned by the processor when processing this job.
   * @defaultValue null
   */
  returnvalue: ReturnType = null;

  /**
   * Stacktrace for the error (for failed jobs).
   * @defaultValue null
   */
  stacktrace: string[] | null = null;

  /**
   * An amount of milliseconds to wait until this job can be processed.
   * @defaultValue 0
   */
  delay = 0;

  /**
   * Ranges from 0 (highest priority) to 2 097 152 (lowest priority). Note that
   * using priorities has a slight impact on performance,
   * so do not use it if not required.
   * @defaultValue 0
   */
  priority = 0;

  /**
   * Timestamp when the job was created (unless overridden with job options).
   */
  timestamp: number;

  /**
   * Number of attempts when job is moved to active.
   * @defaultValue 0
   */
  attemptsStarted = 0;

  /**
   * Number of attempts after the job has failed.
   * @defaultValue 0
   */
  attemptsMade = 0;

  /**
   * Number of times where job has stalled.
   * @defaultValue 0
   */
  stalledCounter = 0;

  /**
   * Reason for failing.
   */
  failedReason: string;

  /**
   * Deferred failure. Stores a failed message and marks this job to be failed directly
   * as soon as the job is picked up by a worker, and using this string as the failed reason.
   */
  deferredFailure: string;

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
   * Debounce identifier.
   * @deprecated use deduplicationId
   */
  debounceId?: string;

  /**
   * Deduplication identifier.
   */
  deduplicationId?: string;

  /**
   * Base repeat job key.
   */
  repeatJobKey?: string;

  /**
   * Produced next repetable job Id.
   *
   */
  nextRepeatableJobId?: string;

  /**
   * The token used for locking this job.
   */
  token?: string;

  /**
   * The worker name that is processing or processed this job.
   */
  processedBy?: string;

  protected toKey: (type: string) => string;

  /**
   * @deprecated use UnrecoverableError
   */
  protected discarded: boolean;

  protected backend: IQueueBackend;

  constructor(
    protected queue: MinimalQueue,
    /**
     * The name of the Job
     */
    public name: NameType,

    /**
     * The payload for this job.
     */
    public data: DataType,

    /**
     * The options object for this job.
     */
    public opts: JobsOptions = {},
    public id?: string,
  ) {
    const { repeatJobKey, ...restOpts } = this.opts;

    this.opts = Object.assign(
      {
        attempts: 0,
      },
      restOpts,
    );

    this.delay = this.opts.delay;

    this.priority = this.opts.priority || 0;

    this.repeatJobKey = repeatJobKey;

    this.timestamp = opts.timestamp ? opts.timestamp : Date.now();

    this.opts.backoff = Backoffs.normalize(opts.backoff);

    this.parentKey = getParentKey(opts.parent);

    if (opts.parent) {
      this.parent = { id: opts.parent.id, queueKey: opts.parent.queue };

      if (opts.failParentOnFailure) {
        this.parent.fpof = true;
      }

      if (opts.removeDependencyOnFailure) {
        this.parent.rdof = true;
      }

      if (opts.ignoreDependencyOnFailure) {
        this.parent.idof = true;
      }

      if (opts.continueParentOnFailure) {
        this.parent.cpof = true;
      }
    }

    this.debounceId = opts.debounce ? opts.debounce.id : undefined;
    this.deduplicationId = opts.deduplication
      ? opts.deduplication.id
      : this.debounceId;

    this.toKey = queue.toKey.bind(queue);
    this.createBackend();

    this.queueQualifiedName = queue.qualifiedName;
  }

  /**
   * Creates a new job and adds it to the queue.
   *
   * @param queue - the queue where to add the job.
   * @param name - the name of the job.
   * @param data - the payload of the job.
   * @param opts - the options bag for this job.
   * @returns The created Job instance
   */
  static async create<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    name: N,
    data: T,
    opts?: JobsOptions,
  ): Promise<Job<T, R, N>> {
    const job = new this<T, R, N>(queue, name, data, opts, opts && opts.jobId);

    const jobData = job.asJSON();
    job.validateOptions(jobData);

    job.id = await job.backend.addJob(jobData, job.id, {
      parentKey: job.parentKey,
      parentDependenciesKey: job.parentKey
        ? `${job.parentKey}:dependencies`
        : '',
    });

    return job;
  }

  /**
   * Creates a bulk of jobs and adds them atomically to the given queue.
   *
   * @param queue - the queue where to add the jobs.
   * @param jobs - an array of jobs to be added to the queue.
   * @returns The created Job instances
   */
  static async createBulk<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    jobs: {
      name: N;
      data: T;
      opts?: BulkJobOptions;
    }[],
  ): Promise<Job<T, R, N>[]> {
    const jobInstances = jobs.map(
      job =>
        new this<T, R, N>(queue, job.name, job.data, job.opts, job.opts?.jobId),
    );

    const scripts = queue.backend;

    const entries = jobInstances.map(job => {
      const jobData = job.asJSON();
      job.validateOptions(jobData);
      return {
        job: jobData,
        jobId: job.id,
        parentKeyOpts: {
          parentKey: job.parentKey,
          parentDependenciesKey: job.parentKey
            ? `${job.parentKey}:dependencies`
            : '',
        },
      };
    });

    const ids = await scripts.addJobs(entries);

    jobInstances.forEach((job, index) => {
      job.id = ids[index];
    });

    return jobInstances;
  }

  /**
   * Instantiates a Job from a {@link JobJson} object (the public, decoded
   * representation of a stored job).
   *
   * @param queue - the queue where the job belongs to.
   * @param json - the plain object containing the job.
   * @param jobId - an optional job id (overrides the id coming from the JSON object)
   * @returns A Job instance reconstructed from the JSON data
   */
  static fromJSON<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    json: JobJson,
    jobId?: string,
  ): Job<T, R, N> {
    const data = JSON.parse(json.data || '{}');

    const job = new this<T, R, N>(
      queue,
      json.name as N,
      data,
      json.opts,
      json.id || jobId,
    );

    job.progress = json.progress ?? 0;

    job.delay = json.delay;

    job.priority = json.priority;

    job.timestamp = json.timestamp;

    if (json.finishedOn) {
      job.finishedOn = json.finishedOn;
    }

    if (json.processedOn) {
      job.processedOn = json.processedOn;
    }

    if (json.repeatJobKey) {
      job.repeatJobKey = json.repeatJobKey;
    }

    if (json.deduplicationId) {
      job.debounceId = json.deduplicationId;
      job.deduplicationId = json.deduplicationId;
    }

    if (json.failedReason) {
      job.failedReason = json.failedReason;
    }

    job.attemptsStarted = json.attemptsStarted ?? 0;

    job.attemptsMade = json.attemptsMade ?? 0;

    job.stalledCounter = json.stalledCounter ?? 0;

    if (json.deferredFailure) {
      job.deferredFailure = json.deferredFailure;
    }

    job.stacktrace = getTraces(json.stacktrace);

    if (typeof json.returnvalue === 'string') {
      job.returnvalue = getReturnValue(json.returnvalue);
    }

    if (json.parentKey) {
      job.parentKey = json.parentKey;
    } else {
      job.parentKey = undefined;
    }

    if (json.parent) {
      job.parent = json.parent;
    } else {
      job.parent = undefined;
    }

    if (json.processedBy) {
      job.processedBy = json.processedBy;
    }

    if (json.nextRepeatableJobId) {
      job.nextRepeatableJobId = json.nextRepeatableJobId;
    }

    return job;
  }

  protected createBackend() {
    this.backend = this.queue.backend;
  }

  static optsFromJSON(
    rawOpts?: string,
    optsDecode: Record<string, string> = optsDecodeMap,
  ): JobsOptions {
    const opts = JSON.parse(rawOpts || '{}');

    const optionEntries = Object.entries(opts) as Array<[string, any]>;

    const options: Partial<Record<string, any>> = {};
    for (const item of optionEntries) {
      const [attributeName, value] = item;
      if ((optsDecode as Record<string, any>)[<string>attributeName]) {
        options[(optsDecode as Record<string, any>)[<string>attributeName]] =
          value;
      } else {
        if (attributeName === 'tm') {
          options.telemetry = { ...options.telemetry, metadata: value };
        } else if (attributeName === 'omc') {
          options.telemetry = { ...options.telemetry, omitContext: value };
        } else {
          options[<string>attributeName] = value;
        }
      }
    }

    return options as JobsOptions;
  }

  /**
   * Fetches a Job from the queue given the passed job id.
   *
   * @param queue - the queue where the job belongs to.
   * @param jobId - the job id.
   * @returns
   */
  static async fromId<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    jobId: string,
  ): Promise<Job<T, R, N> | undefined> {
    // jobId can be undefined if moveJob returns undefined
    if (jobId) {
      const scripts = queue.backend;
      const jobData = await scripts.getJobData(jobId);
      return jobData
        ? this.fromJSON<T, R, N>(queue, jobData, jobId)
        : undefined;
    }
  }

  /**
   * addJobLog
   *
   * @param queue - A minimal queue instance
   * @param jobId - Job id
   * @param logRow - String with a row of log data to be logged
   * @param keepLogs - The optional amount of log entries to preserve
   *
   * @returns The total number of log entries for this job so far.
   */
  static addJobLog(
    queue: MinimalQueue,
    jobId: string,
    logRow: string,
    keepLogs?: number,
  ): Promise<number> {
    const scripts = (queue as any).backend as IQueueBackend;

    return scripts.addLog(jobId, logRow, keepLogs);
  }

  toJSON() {
    const { queue, backend: scripts, ...withoutQueueAndScripts } = this;
    return withoutQueueAndScripts;
  }

  /**
   * Prepares a job to be serialized for storage in Redis.
   * @returns
   */
  asJSON(): JobJson {
    return removeUndefinedFields<JobJson>({
      id: this.id,
      name: this.name,
      data: JSON.stringify(typeof this.data === 'undefined' ? {} : this.data),
      opts: this.opts,
      parent: this.parent ? { ...this.parent } : undefined,
      parentKey: this.parentKey,
      progress: this.progress,
      attemptsMade: this.attemptsMade,
      attemptsStarted: this.attemptsStarted,
      stalledCounter: this.stalledCounter,
      finishedOn: this.finishedOn,
      processedOn: this.processedOn,
      timestamp: this.timestamp,
      failedReason: JSON.stringify(this.failedReason),
      stacktrace: JSON.stringify(this.stacktrace),
      debounceId: this.debounceId,
      deduplicationId: this.deduplicationId,
      repeatJobKey: this.repeatJobKey,
      returnvalue: JSON.stringify(this.returnvalue),
      nextRepeatableJobId: this.nextRepeatableJobId,
    });
  }

  /**
   * Prepares a job to be passed to Sandbox.
   * @returns
   */
  asJSONSandbox(): JobJsonSandbox {
    return {
      ...this.asJSON(),
      queueName: this.queueName,
      queueQualifiedName: this.queueQualifiedName,
      prefix: this.prefix,
    };
  }

  /**
   * Updates a job's data
   *
   * @param data - the data that will replace the current jobs data.
   */
  updateData(data: DataType): Promise<void> {
    this.data = data;

    return this.backend.updateData<DataType, ReturnType, NameType>(this, data);
  }

  /**
   * Updates a job's progress
   *
   * @param progress - number or object to be saved as progress.
   */
  async updateProgress(progress: JobProgress): Promise<void> {
    this.progress = progress;
    await this.backend.updateProgress(this.id, progress);
    this.queue.emit('progress', this, progress);
  }

  /**
   * Logs one row of log data.
   *
   * @param logRow - string with log data to be logged.
   * @returns The total number of log entries for this job so far.
   */
  async log(logRow: string): Promise<number> {
    return Job.addJobLog(this.queue, this.id, logRow, this.opts.keepLogs);
  }

  /**
   * Removes child dependency from parent when child is not yet finished
   *
   * @returns True if the relationship existed and if it was removed.
   */
  async removeChildDependency(): Promise<boolean> {
    const childDependencyIsRemoved = await this.backend.removeChildDependency(
      this.id,
      this.parentKey,
    );
    if (childDependencyIsRemoved) {
      this.parent = undefined;
      this.parentKey = undefined;
      return true;
    }

    return false;
  }

  /**
   * Clears job's logs
   *
   * @param keepLogs - the amount of log entries to preserve
   */
  async clearLogs(keepLogs?: number): Promise<void> {
    await this.backend.clearLogs(this.id, keepLogs);
  }

  /**
   * Completely remove the job from the queue.
   * Note, this call will throw an exception if the job
   * is being processed when the call is performed.
   *
   * @param opts - Options to remove a job
   */
  async remove({ removeChildren = true } = {}): Promise<void> {
    await this.queue.waitUntilReady();

    const queue = this.queue;
    const job = this;

    const removed = await this.backend.remove(job.id, removeChildren);
    if (removed) {
      queue.emit('removed', job);
    } else {
      throw new Error(
        `Job ${this.id} could not be removed because it is locked by another worker`,
      );
    }
  }

  /**
   * Remove all children from this job that are not yet processed,
   * in other words that are in any other state than completed, failed or active.
   *
   * @remarks
   *  - Jobs with locks (most likely active) are ignored.
   *  - This method can be slow if the number of children is large (\> 1000).
   */
  async removeUnprocessedChildren(): Promise<void> {
    const jobId = this.id;
    await this.backend.removeUnprocessedChildren(jobId);
  }

  /**
   * Extend the lock for this job.
   *
   * @param token - unique token for the lock
   * @param duration - lock duration in milliseconds
   */
  extendLock(token: string, duration: number): Promise<number> {
    return this.backend.extendLock(this.id, token, duration);
  }

  /**
   * Moves a job to the completed queue.
   * Returned job to be used with Queue.prototype.nextJobFromJobData.
   *
   * @param returnValue - The jobs success message.
   * @param token - Worker token used to acquire completed job.
   * @param fetchNext - True when wanting to fetch the next job.
   * @returns Returns the jobData of the next job in the waiting queue or void.
   */
  async moveToCompleted(
    returnValue: ReturnType,
    token: string,
    fetchNext = true,
  ): Promise<void | any[]> {
    return this.queue.trace<Promise<void | any[]>>(
      SpanKind.INTERNAL,
      'complete',
      this.queue.name,
      async span => {
        this.setSpanJobAttributes(span);

        await this.queue.waitUntilReady();

        this.returnvalue = returnValue || void 0;

        const stringifiedReturnValue = tryCatch(JSON.stringify, JSON, [
          returnValue,
        ]);
        if (stringifiedReturnValue === errorObject) {
          throw errorObject.value;
        }

        const { result, finishedOn } = await this.backend.moveToCompleted(
          this,
          returnValue,
          this.opts.removeOnComplete,
          token,
          fetchNext,
        );
        this.finishedOn = finishedOn;
        this.attemptsMade += 1;

        this.recordJobMetrics('completed');

        return result;
      },
    );
  }

  /**
   * Moves a job to the wait or prioritized state.
   *
   * @param token - Worker token used to acquire completed job.
   * @returns Returns pttl.
   */
  async moveToWait(token?: string): Promise<number> {
    const result = await this.backend.moveJobFromActiveToWait(this.id, token);

    this.recordJobMetrics('waiting');

    return result;
  }

  private async shouldRetryJob(err: Error): Promise<[boolean, number]> {
    if (
      this.attemptsMade + 1 < this.opts.attempts &&
      !this.discarded &&
      !(err instanceof UnrecoverableError || err.name == 'UnrecoverableError')
    ) {
      const opts = this.queue.opts as WorkerOptions;

      const delay = await Backoffs.calculate(
        <BackoffOptions>this.opts.backoff,
        this.attemptsMade + 1,
        err,
        this,
        opts.settings && opts.settings.backoffStrategy,
      );

      return [delay == -1 ? false : true, delay == -1 ? 0 : delay];
    } else {
      return [false, 0];
    }
  }

  /**
   * Moves a job to the failed queue.
   *
   * @param err - the jobs error message.
   * @param token - token to check job is locked by current worker
   * @param fetchNext - true when wanting to fetch the next job
   * @returns Returns the jobData of the next job in the waiting queue or void.
   */
  async moveToFailed<E extends Error>(
    err: E,
    token: string,
    fetchNext = false,
  ): Promise<void | any[]> {
    this.failedReason = err?.message;

    // Check if an automatic retry should be performed
    const [shouldRetry, retryDelay] = await this.shouldRetryJob(err);

    return this.queue.trace<Promise<void | any[]>>(
      SpanKind.INTERNAL,
      this.getSpanOperation(shouldRetry, retryDelay),
      this.queue.name,
      async (span, dstPropagationMetadata) => {
        this.setSpanJobAttributes(span);

        let tm;
        if (!this.opts?.telemetry?.omitContext && dstPropagationMetadata) {
          tm = dstPropagationMetadata;
        }
        let result;

        this.updateStacktrace(err);

        const fieldsToUpdate = {
          failedReason: this.failedReason,
          stacktrace: JSON.stringify(this.stacktrace),
          tm,
        };

        let finishedOn: number;
        if (shouldRetry) {
          if (retryDelay) {
            // Retry with delay
            result = await this.backend.moveToDelayed(
              this.id,
              Date.now(),
              retryDelay,
              token,
              { fieldsToUpdate, fetchNext },
            );

            this.recordJobMetrics('delayed');
          } else {
            // Retry immediately
            result = await this.backend.retryJob(
              this.id,
              this.opts.lifo,
              token,
              {
                fieldsToUpdate,
              },
            );

            this.recordJobMetrics('retried');
          }
        } else {
          const moved = await this.backend.moveToFailed(
            this,
            this.failedReason,
            this.opts.removeOnFail,
            token,
            fetchNext,
            fieldsToUpdate,
          );
          result = moved.result;
          finishedOn = moved.finishedOn;

          // Only record failed metrics when job is not retrying
          this.recordJobMetrics('failed');
        }

        if (finishedOn && typeof finishedOn === 'number') {
          this.finishedOn = finishedOn;
        }

        if (retryDelay && typeof retryDelay === 'number') {
          this.delay = retryDelay;
        }

        this.attemptsMade += 1;

        return result;
      },
    );
  }

  private getSpanOperation(shouldRetry: boolean, retryDelay: number): string {
    if (shouldRetry) {
      if (retryDelay) {
        return 'delay';
      }

      return 'retry';
    }

    return 'fail';
  }

  /**
   * Records job metrics if a meter is configured in telemetry options.
   *
   * @param status - The job status
   */
  private recordJobMetrics(
    status:
      | 'completed'
      | 'failed'
      | 'delayed'
      | 'retried'
      | 'waiting'
      | 'waiting-children',
  ): void {
    const meter = this.queue.opts?.telemetry?.meter;
    if (!meter) {
      return;
    }

    const attributes = {
      [TelemetryAttributes.QueueName]: this.queue.name,
      [TelemetryAttributes.JobName]: this.name,
      [TelemetryAttributes.JobStatus]: status,
    };

    // Record counter metric based on status
    const statusToCounterName: Record<
      | 'completed'
      | 'failed'
      | 'delayed'
      | 'retried'
      | 'waiting'
      | 'waiting-children',
      MetricNames
    > = {
      completed: MetricNames.JobsCompleted,
      failed: MetricNames.JobsFailed,
      delayed: MetricNames.JobsDelayed,
      retried: MetricNames.JobsRetried,
      waiting: MetricNames.JobsWaiting,
      'waiting-children': MetricNames.JobsWaitingChildren,
    };

    const counterName = statusToCounterName[status];
    const counter = meter.createCounter(counterName, {
      description: `Number of jobs ${status}`,
      unit: '1',
    });
    counter.add(1, attributes);

    // Record duration histogram if processedOn is available
    if (this.processedOn) {
      const duration = Date.now() - this.processedOn;
      const histogram = meter.createHistogram(MetricNames.JobDuration, {
        description: 'Job processing duration',
        unit: 'ms',
      });
      histogram.record(duration, attributes);
    }
  }

  /**
   * @returns true if the job has completed.
   */
  isCompleted(): Promise<boolean> {
    return this.isInZSet('completed');
  }

  /**
   * @returns true if the job has failed.
   */
  isFailed(): Promise<boolean> {
    return this.isInZSet('failed');
  }

  /**
   * @returns true if the job is delayed.
   */
  isDelayed(): Promise<boolean> {
    return this.isInZSet('delayed');
  }

  /**
   * @returns true if the job is waiting for children.
   */
  isWaitingChildren(): Promise<boolean> {
    return this.isInZSet('waiting-children');
  }

  /**
   * @returns true of the job is active.
   */
  isActive(): Promise<boolean> {
    return this.isInList('active');
  }

  /**
   * @returns true if the job is waiting.
   */
  async isWaiting(): Promise<boolean> {
    return (await this.isInList('wait')) || (await this.isInList('paused'));
  }

  /**
   * @returns the queue name this job belongs to.
   */
  get queueName(): string {
    return this.queue.name;
  }

  /**
   * @returns the prefix that is used.
   */
  get prefix(): string {
    return this.queue.opts.prefix;
  }

  /**
   * Get current state.
   *
   * @returns Returns one of these values:
   * 'completed', 'failed', 'delayed', 'active', 'waiting', 'waiting-children', 'unknown'.
   */
  getState(): Promise<JobState | 'unknown'> {
    return this.backend.getState(this.id);
  }

  /**
   * Change delay of a delayed job.
   *
   * Reschedules a delayed job by setting a new delay from the current time.
   * For example, calling changeDelay(5000) will reschedule the job to execute
   * 5000 milliseconds (5 seconds) from now, regardless of the original delay.
   *
   * @param delay - milliseconds from now when the job should be processed.
   * @returns void
   * @throws JobNotExist
   * This exception is thrown if jobId is missing.
   * @throws JobNotInState
   * This exception is thrown if job is not in delayed state.
   */
  async changeDelay(delay: number): Promise<void> {
    await this.backend.changeDelay(this.id, delay);
    this.delay = delay;
  }

  /**
   * Change job priority.
   *
   * @param opts - options containing priority and lifo values.
   * @returns void
   */
  async changePriority(opts: {
    priority?: number;
    lifo?: boolean;
  }): Promise<void> {
    await this.backend.changePriority(this.id, opts.priority, opts.lifo);
    this.priority = opts.priority || 0;
  }

  /**
   * Get this jobs children result values if any.
   *
   * @returns Object mapping children job keys with their values.
   */
  async getChildrenValues<CT = any>(): Promise<{ [jobKey: string]: CT }> {
    const result = await this.backend.getProcessedChildrenValues(this.id);

    if (result) {
      return parseObjectValues(result);
    }
  }

  /**
   * Retrieves the failures of child jobs that were explicitly ignored while using ignoreDependencyOnFailure option.
   * This method is useful for inspecting which child jobs were intentionally ignored when an error occurred.
   * @see {@link https://docs.bullmq.io/guide/flows/ignore-dependency}
   *
   * @returns Object mapping children job keys with their failure values.
   */
  async getIgnoredChildrenFailures(): Promise<{ [jobKey: string]: string }> {
    return this.backend.getIgnoredChildrenFailures(this.id);
  }

  /**
   * Get job's children failure values that were ignored if any.
   *
   * @deprecated This method is deprecated and will be removed in v6. Use getIgnoredChildrenFailures instead.
   *
   * @returns Object mapping children job keys with their failure values.
   */
  async getFailedChildrenValues(): Promise<{ [jobKey: string]: string }> {
    return this.backend.getIgnoredChildrenFailures(this.id);
  }

  /**
   * Get children job keys if this job is a parent and has children.
   * @remarks
   * Count options before Redis v7.2 works as expected with any quantity of entries
   * on processed/unprocessed dependencies, since v7.2 you must consider that count
   * won't have any effect until processed/unprocessed dependencies have a length
   * greater than 127
   * @see {@link https://redis.io/docs/management/optimization/memory-optimization/#redis--72}
   * @see {@link https://docs.bullmq.io/guide/flows#getters}
   * @returns dependencies separated by processed, unprocessed, ignored and failed.
   */
  async getDependencies(opts: DependenciesOpts = {}): Promise<{
    nextFailedCursor?: number;
    failed?: string[];
    nextIgnoredCursor?: number;
    ignored?: Record<string, any>;
    nextProcessedCursor?: number;
    processed?: Record<string, any>;
    nextUnprocessedCursor?: number;
    unprocessed?: string[];
  }> {
    return this.backend.getDependencies(this.id, opts);
  }

  /**
   * Get children job counts if this job is a parent and has children.
   *
   * @returns dependencies count separated by processed, unprocessed, ignored and failed.
   */
  async getDependenciesCount(
    opts: {
      failed?: boolean;
      ignored?: boolean;
      processed?: boolean;
      unprocessed?: boolean;
    } = {},
  ): Promise<{
    failed?: number;
    ignored?: number;
    processed?: number;
    unprocessed?: number;
  }> {
    const types: string[] = [];
    Object.entries(opts).forEach(([key, value]) => {
      if (value) {
        types.push(key);
      }
    });

    const finalTypes = types.length
      ? types
      : ['processed', 'unprocessed', 'ignored', 'failed'];
    const responses = await this.backend.getDependencyCounts(
      this.id,
      finalTypes,
    );

    const counts: { [index: string]: number } = {};
    responses.forEach((res, index) => {
      counts[`${finalTypes[index]}`] = res || 0;
    });

    return counts;
  }

  /**
   * Returns a promise the resolves when the job has completed (containing the return value of the job),
   * or rejects when the job has failed (containing the failedReason).
   *
   * @param queueEvents - Instance of QueueEvents.
   * @param ttl - Time in milliseconds to wait for job to finish before timing out.
   */
  async waitUntilFinished(
    queueEvents: QueueEvents,
    ttl?: number,
  ): Promise<ReturnType> {
    await this.queue.waitUntilReady();

    const jobId = this.id;
    return new Promise<any>(async (resolve, reject) => {
      let timeout: NodeJS.Timeout;
      if (ttl) {
        timeout = setTimeout(
          () =>
            onFailed(
              /* eslint-disable max-len */
              `Job wait ${this.name} timed out before finishing, no finish notification arrived after ${ttl}ms (id=${jobId})`,
              /* eslint-enable max-len */
            ),
          ttl,
        );
      }

      function onCompleted(args: any) {
        removeListeners();
        resolve(args.returnvalue);
      }

      function onFailed(args: any) {
        removeListeners();
        reject(new Error(args.failedReason || args));
      }

      const completedEvent = `completed:${jobId}`;
      const failedEvent = `failed:${jobId}`;

      queueEvents.on(completedEvent as any, onCompleted);
      queueEvents.on(failedEvent as any, onFailed);
      this.queue.on('closing', onFailed);

      const removeListeners = () => {
        clearInterval(timeout);
        queueEvents.removeListener(completedEvent, onCompleted);
        queueEvents.removeListener(failedEvent, onFailed);
        this.queue.removeListener('closing', onFailed);
      };

      // Poll once right now to see if the job has already finished. The job may have been completed before we were able
      // to register the event handlers on the QueueEvents, so we check here to make sure we're not waiting for an event
      // that has already happened. We block checking the job until the queue events object is actually listening to
      // Redis so there's no chance that it will miss events.
      await queueEvents.waitUntilReady();
      const [status, result] = (await this.backend.isFinished(jobId, true)) as [
        number,
        string,
      ];
      const finished = status != 0;
      if (finished) {
        if (status == -1 || status == 2) {
          onFailed({ failedReason: result });
        } else {
          onCompleted({ returnvalue: getReturnValue(result) });
        }
      }
    });
  }

  /**
   * Moves the job to the delay set.
   *
   * @param timestamp - timestamp when the job should be moved back to "wait"
   * @param token - token to check job is locked by current worker
   * @returns
   */
  async moveToDelayed(timestamp: number, token?: string): Promise<void> {
    const now = Date.now();
    const delay = timestamp - now;
    const finalDelay = delay > 0 ? delay : 0;
    await this.backend.moveToDelayed(this.id, now, finalDelay, token, {
      skipAttempt: true,
    });
    this.delay = finalDelay;

    this.recordJobMetrics('delayed');
  }

  /**
   * Moves the job to the waiting-children set.
   *
   * @param token - Token to check job is locked by current worker
   * @param opts - The options bag for moving a job to waiting-children.
   * @returns true if the job was moved
   */
  async moveToWaitingChildren(
    token: string,
    opts: MoveToWaitingChildrenOpts = {},
  ): Promise<boolean> {
    const movedToWaitingChildren = await this.backend.moveToWaitingChildren(
      this.id,
      token,
      opts,
    );

    if (movedToWaitingChildren) {
      this.recordJobMetrics('waiting-children');
    }

    return movedToWaitingChildren;
  }

  /**
   * Promotes a delayed job so that it starts to be processed as soon as possible.
   */
  async promote(): Promise<void> {
    const jobId = this.id;

    await this.backend.promote(jobId);

    this.delay = 0;
  }

  /**
   * Attempts to retry the job. Only a job that has failed or completed can be retried.
   *
   * @param state - completed / failed
   * @param opts - options to retry a job
   * @returns A promise that resolves when the job has been successfully moved to the wait queue.
   * The queue emits a waiting event when the job is successfully moved.
   * @throws Will throw an error if the job does not exist, is locked, or is not in the expected state.
   */
  async retry(
    state: FinishedStatus = 'failed',
    opts: RetryOptions = {},
  ): Promise<void> {
    await this.backend.reprocessJob(this, state, opts);
    this.failedReason = null;
    this.finishedOn = null;
    this.processedOn = null;
    this.returnvalue = null;

    if (opts.resetAttemptsMade) {
      this.attemptsMade = 0;
    }

    if (opts.resetAttemptsStarted) {
      this.attemptsStarted = 0;
    }
  }

  /**
   * Marks a job to not be retried if it fails (even if attempts has been configured)
   * @deprecated use UnrecoverableError
   */
  discard(): void {
    this.discarded = true;
  }

  private async isInZSet(set: string): Promise<boolean> {
    return this.backend.isJobInZSet(set, this.id);
  }

  private async isInList(list: string): Promise<boolean> {
    return this.backend.isJobInList(this.queue.toKey(list), this.id);
  }

  /**
   * Adds the job to Redis.
   *
   * @param client - The Redis client to use for adding the job.
   * @param parentOpts - Options for the parent-child relationship.
   * @returns The job ID
   */
  addJob(
    client: RedisClient | IRedisTransaction,
    parentOpts?: ParentKeyOpts,
  ): Promise<string> {
    const jobData = this.asJSON();

    this.validateOptions(jobData);

    // `addJobToTransaction` operates on a raw Redis client/transaction and is
    // therefore specific to the Redis backend implementation.
    return (this.backend as RedisQueueBackend).addJobToTransaction(
      client,
      jobData,
      this.id,
      parentOpts,
    );
  }

  /**
   * Builds the data needed to insert this job as part of a flow, without
   * touching the datastore. Used by FlowProducer to collect a whole flow tree
   * and hand it to the backend's atomic `addFlow` operation.
   *
   * @param parentOpts - parent-link options for this node.
   */
  toFlowEntry(parentOpts: ParentKeyOpts = {}): {
    jobData: JobJson;
    jobId: string;
    parentKeyOpts: ParentKeyOpts;
    prefix: string;
    queueName: string;
  } {
    const jobData = this.asJSON();
    this.validateOptions(jobData);
    return {
      jobData,
      jobId: this.id,
      parentKeyOpts: parentOpts,
      prefix: this.prefix,
      queueName: this.queueName,
    };
  }

  /**
   * Removes a deduplication key if job is still the cause of deduplication.
   * @returns true if the deduplication key was removed.
   */
  async removeDeduplicationKey(): Promise<boolean> {
    if (this.deduplicationId) {
      const result = await this.backend.removeDeduplicationKey(
        this.deduplicationId,
        this.id,
      );
      return result > 0;
    }
    return false;
  }

  protected validateOptions(jobData: JobJson) {
    const exclusiveOptions: (keyof JobsOptions)[] = [
      'removeDependencyOnFailure',
      'failParentOnFailure',
      'continueParentOnFailure',
      'ignoreDependencyOnFailure',
    ];

    const exceedLimit =
      this.opts.sizeLimit &&
      lengthInUtf8Bytes(jobData.data) > this.opts.sizeLimit;

    if (exceedLimit) {
      throw new Error(
        `The size of job ${this.name} exceeds the limit ${this.opts.sizeLimit} bytes`,
      );
    }

    const enabledExclusiveOptions = exclusiveOptions.filter(
      opt => this.opts[opt],
    );

    if (enabledExclusiveOptions.length > 1) {
      const optionsList = enabledExclusiveOptions.join(', ');
      throw new Error(
        `The following options cannot be used together: ${optionsList}`,
      );
    }

    if (this.opts?.jobId) {
      if (`${parseInt(this.opts.jobId, 10)}` === this.opts?.jobId) {
        throw new Error('Custom Id cannot be integers');
      }

      // TODO: replace this check in next breaking check with include(':')
      // By using split we are still keeping compatibility with old repeatable jobs
      if (
        this.opts?.jobId.includes(':') &&
        this.opts?.jobId?.split(':').length !== 3
      ) {
        throw new Error('Custom Id cannot contain :');
      }
    }

    if (this.opts.priority) {
      if (Math.trunc(this.opts.priority) !== this.opts.priority) {
        throw new Error(`Priority should not be float`);
      }

      if (this.opts.priority > PRIORITY_LIMIT) {
        throw new Error(`Priority should be between 0 and ${PRIORITY_LIMIT}`);
      }
    }

    if (this.opts.deduplication) {
      if (!this.opts.deduplication?.id) {
        throw new Error('Deduplication id must be provided');
      }

      if (this.parentKey) {
        throw new Error(
          'Deduplication and parent options cannot be used together',
        );
      }
    }

    // TODO: remove in v6
    if (this.opts.debounce) {
      if (!this.opts.debounce?.id) {
        throw new Error('Debounce id must be provided');
      }

      if (this.parentKey) {
        throw new Error('Debounce and parent options cannot be used together');
      }
    }

    if (
      typeof this.opts.backoff === 'object' &&
      typeof this.opts.backoff.jitter === 'number'
    ) {
      if (this.opts.backoff.jitter < 0 || this.opts.backoff.jitter > 1) {
        throw new Error(`Jitter should be between 0 and 1`);
      }
    }
  }

  protected updateStacktrace(err: Error) {
    this.stacktrace = this.stacktrace || [];

    if (err?.stack) {
      this.stacktrace.push(err.stack);
      if (this.opts.stackTraceLimit === 0) {
        this.stacktrace = [];
      } else if (this.opts.stackTraceLimit) {
        this.stacktrace = this.stacktrace.slice(-this.opts.stackTraceLimit);
      }
    }
  }

  private setSpanJobAttributes(span?: Span) {
    span?.setAttributes({
      [TelemetryAttributes.JobName]: this.name,
      [TelemetryAttributes.JobId]: this.id,
    });
  }
}

function getTraces(stacktrace?: string) {
  if (!stacktrace) {
    return [];
  }

  const traces = tryCatch(JSON.parse, JSON, [stacktrace]);

  if (traces === errorObject || !(traces instanceof Array)) {
    return [];
  } else {
    return traces;
  }
}

function getReturnValue(_value: any) {
  const value = tryCatch(JSON.parse, JSON, [_value]);
  if (value !== errorObject) {
    return value;
  } else {
    logger('corrupted returnvalue: ' + _value, value);
  }
}
