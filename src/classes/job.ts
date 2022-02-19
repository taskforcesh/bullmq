import { Pipeline } from 'ioredis';
import { fromPairs } from 'lodash';
import { debuglog } from 'util';
import {
  BackoffOptions,
  JobJson,
  JobJsonRaw,
  JobsOptions,
  ParentKeys,
  RedisClient,
  WorkerOptions,
} from '../interfaces';
import { JobState, JobJsonSandbox } from '../types';
import {
  errorObject,
  isEmpty,
  getParentKey,
  lengthInUtf8Bytes,
  tryCatch,
} from '../utils';
import { QueueEvents } from './queue-events';
import { Backoffs } from './backoffs';
import { MinimalQueue, ParentOpts, Scripts, JobData } from './scripts';
import { UnrecoverableError } from './unrecoverable-error';

const logger = debuglog('bull');

export type BulkJobOptions = Omit<JobsOptions, 'repeat'>;

export interface MoveToChildrenOpts {
  timestamp?: number;
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

export class Job<
  DataType = any,
  ReturnType = any,
  NameType extends string = string,
> {
  /**
   * The progress a job has performed so far.
   * @defaultValue 0
   */
  progress: number | object = 0;

  /**
   * The value returned by the processor when processing this job.
   * @defaultValue null
   */
  returnvalue: ReturnType = null;

  /**
   * Stacktrace for the error (for failed jobs).
   * @defaultValue null
   */
  stacktrace: string[] = null;

  /**
   * Timestamp when the job was created (unless overridden with job options).
   */
  timestamp: number;

  /**
   * Number of attempts after the job has failed.
   * @defaultValue 0
   */
  attemptsMade = 0;

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

  protected toKey: (type: string) => string;

  private discarded: boolean;

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
    this.opts = Object.assign(
      {
        attempts: 0,
        delay: 0,
      },
      opts,
    );

    this.timestamp = opts.timestamp ? opts.timestamp : Date.now();

    this.opts.backoff = Backoffs.normalize(opts.backoff);

    this.parentKey = getParentKey(opts.parent);

    this.parent = opts.parent
      ? { id: opts.parent.id, queueKey: opts.parent.queue }
      : undefined;

    this.toKey = queue.toKey.bind(queue);
  }

  /**
   * Creates a new job and adds it to the queue.
   *
   * @param queue - the queue where to add the job.
   * @param name - the name of the job.
   * @param data - the payload of the job.
   * @param opts - the options bag for this job.
   * @returns
   */
  static async create<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    name: N,
    data: T,
    opts?: JobsOptions,
  ): Promise<Job<T, R, N>> {
    const client = await queue.client;

    const job = new this<T, R, N>(queue, name, data, opts, opts && opts.jobId);

    job.id = await job.addJob(client, {
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
   * @param queue -the queue were to add the jobs.
   * @param jobs - an array of jobs to be added to the queue.
   * @returns
   */
  static async createBulk<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    jobs: {
      name: N;
      data: T;
      opts?: BulkJobOptions;
    }[],
  ): Promise<Job<T, R, N>[]> {
    const client = await queue.client;

    const jobInstances = jobs.map(
      job =>
        new this<T, R, N>(queue, job.name, job.data, job.opts, job.opts?.jobId),
    );

    const multi = client.multi();

    for (const job of jobInstances) {
      job.addJob(<RedisClient>(multi as unknown), {
        parentKey: job.parentKey,
        parentDependenciesKey: job.parentKey
          ? `${job.parentKey}:dependencies`
          : '',
      });
    }

    const result = (await multi.exec()) as [null | Error, string][];
    result.forEach((res, index: number) => {
      const [err, id] = res;
      jobInstances[index].id = id;
    });

    return jobInstances;
  }

  /**
   * Instantiates a Job from a JobJsonRaw object (coming from a deserialized JSON object)
   *
   * @param queue - the queue where the job belongs to.
   * @param json - the plain object containing the job.
   * @param jobId - an optional job id (overrides the id coming from the JSON object)
   * @returns
   */
  static fromJSON<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    json: JobJsonRaw,
    jobId?: string,
  ): Job<T, R, N> {
    const data = JSON.parse(json.data || '{}');
    const opts = JSON.parse(json.opts || '{}');

    const job = new this<T, R, N>(
      queue,
      json.name as N,
      data,
      opts,
      json.id || jobId,
    );

    job.progress = JSON.parse(json.progress || '0');

    // job.delay = parseInt(json.delay);
    job.timestamp = parseInt(json.timestamp);

    if (json.finishedOn) {
      job.finishedOn = parseInt(json.finishedOn);
    }

    if (json.processedOn) {
      job.processedOn = parseInt(json.processedOn);
    }

    job.failedReason = json.failedReason;
    job.attemptsMade = parseInt(json.attemptsMade || '0');

    job.stacktrace = getTraces(json.stacktrace);

    if (typeof json.returnvalue === 'string') {
      job.returnvalue = getReturnValue(json.returnvalue);
    }

    if (json.parentKey) {
      job.parentKey = json.parentKey;
    }

    if (json.parent) {
      job.parent = JSON.parse(json.parent);
    }

    return job;
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
      const client = await queue.client;
      const jobData = await client.hgetall(queue.toKey(jobId));
      return isEmpty(jobData)
        ? undefined
        : Job.fromJSON<T, R, N>(queue, (<unknown>jobData) as JobJsonRaw, jobId);
    }
  }

  toJSON(): Omit<this, 'queue'> {
    const { queue, ...withoutQueue } = this;
    return withoutQueue;
  }

  /**
   * Prepares a job to be serialized for storage in Redis.
   * @returns
   */
  asJSON(): JobJson {
    return {
      id: this.id,
      name: this.name,
      data: JSON.stringify(typeof this.data === 'undefined' ? {} : this.data),
      opts: this.opts,
      progress: this.progress,
      attemptsMade: this.attemptsMade,
      finishedOn: this.finishedOn,
      processedOn: this.processedOn,
      timestamp: this.timestamp,
      failedReason: JSON.stringify(this.failedReason),
      stacktrace: JSON.stringify(this.stacktrace),
      returnvalue: JSON.stringify(this.returnvalue),
    };
  }

  /**
   * Prepares a job to be passed to Sandbox.
   * @returns
   */
  asJSONSandbox(): JobJsonSandbox {
    return {
      ...this.asJSON(),
      queueName: this.queueName,
      parent: this.parent ? { ...this.parent } : undefined,
      prefix: this.prefix,
    };
  }

  /**
   * Updates a job's data
   *
   * @param data - the data that will replace the current jobs data.
   */
  update(data: DataType): Promise<void> {
    this.data = data;

    return Scripts.updateData<DataType, ReturnType, NameType>(
      this.queue,
      this,
      data,
    );
  }

  /**
   * Updates a job's progress
   *
   * @param progress - number or object to be saved as progress.
   */
  updateProgress(progress: number | object): Promise<void> {
    this.progress = progress;
    return Scripts.updateProgress(this.queue, this, progress);
  }

  /**
   * Logs one row of log data.
   *
   * @param logRow - string with log data to be logged.
   */
  async log(logRow: string): Promise<number> {
    const client = await this.queue.client;
    const logsKey = this.toKey(this.id) + ':logs';
    return client.rpush(logsKey, logRow);
  }

  /**
   * Completely remove the job from the queue.
   * Note, this call will throw an exception if the job
   * is being processed when the call is performed.
   */
  async remove(): Promise<void> {
    await this.queue.waitUntilReady();

    const queue = this.queue;
    const job = this;

    const removed = await Scripts.remove(queue, job.id);
    if (removed) {
      queue.emit('removed', job);
    } else {
      throw new Error('Could not remove job ' + job.id);
    }
  }

  /**
   * Extend the lock for this job.
   *
   * @param token - unique token for the lock
   * @param duration - lock duration in milliseconds
   */
  extendLock(token: string, duration: number): Promise<number> {
    return Scripts.extendLock(this.queue, this.id, token, duration);
  }

  /**
   * Moves a job to the completed queue.
   * Returned job to be used with Queue.prototype.nextJobFromJobData.
   *
   * @param returnValue - The jobs success message.
   * @param token - Worker token used to acquire completed job.
   * @param fetchNext - True when wanting to fetch the next job.
   * @returns Returns the jobData of the next job in the waiting queue.
   */
  async moveToCompleted(
    returnValue: ReturnType,
    token: string,
    fetchNext = true,
  ): Promise<JobData | []> {
    await this.queue.waitUntilReady();

    this.returnvalue = returnValue || void 0;

    const stringifiedReturnValue = tryCatch(JSON.stringify, JSON, [
      returnValue,
    ]);
    if (stringifiedReturnValue === errorObject) {
      throw errorObject.value;
    }

    return Scripts.moveToCompleted(
      this.queue,
      this,
      stringifiedReturnValue,
      this.opts.removeOnComplete,
      token,
      fetchNext,
    );
  }

  /**
   * Moves a job to the failed queue.
   *
   * @param err - the jobs error message.
   * @param token - token to check job is locked by current worker
   * @param fetchNext - true when wanting to fetch the next job
   * @returns void
   */
  async moveToFailed<E extends Error>(
    err: E,
    token: string,
    fetchNext = false,
  ): Promise<void> {
    const client = await this.queue.client;
    const message = err?.message;

    const queue = this.queue;
    this.failedReason = message;

    let command: string;
    const multi = client.multi();
    this.saveStacktrace(multi, err);

    //
    // Check if an automatic retry should be performed
    //
    let moveToFailed = false;
    if (
      this.attemptsMade < this.opts.attempts &&
      !this.discarded &&
      !(err instanceof UnrecoverableError)
    ) {
      const opts = queue.opts as WorkerOptions;

      // Check if backoff is needed
      const delay = await Backoffs.calculate(
        <BackoffOptions>this.opts.backoff,
        this.attemptsMade,
        opts.settings && opts.settings.backoffStrategies,
        err,
        this,
      );

      if (delay === -1) {
        moveToFailed = true;
      } else if (delay) {
        const args = Scripts.moveToDelayedArgs(
          queue,
          this.id,
          Date.now() + delay,
        );
        (<any>multi).moveToDelayed(args);
        command = 'delayed';
      } else {
        // Retry immediately
        (<any>multi).retryJob(Scripts.retryJobArgs(queue, this));
        command = 'retry';
      }
    } else {
      // If not, move to failed
      moveToFailed = true;
    }

    if (moveToFailed) {
      const args = Scripts.moveToFailedArgs(
        queue,
        this,
        message,
        this.opts.removeOnFail,
        token,
        fetchNext,
      );
      (<any>multi).moveToFinished(args);
      command = 'failed';
    }

    const results = await multi.exec();
    const code = results[results.length - 1][1];
    if (code < 0) {
      throw Scripts.finishedErrors(code, this.id, command, 'active');
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

  get queueName(): string {
    return this.queue.name;
  }

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
    return Scripts.getState(this.queue, this.id);
  }

  /**
   * Change delay of a delayed job.
   *
   * @param delay - milliseconds to be added to current time.
   * @returns void
   */
  changeDelay(delay: number): Promise<void> {
    return Scripts.changeDelay(this.queue, this.id, delay);
  }

  /**
   * Get this jobs children result values if any.
   *
   * @returns Object mapping children job keys with their values.
   */
  async getChildrenValues<CT = any>(): Promise<{ [jobKey: string]: CT }> {
    const client = await this.queue.client;

    const result = (await client.hgetall(
      this.toKey(`${this.id}:processed`),
    )) as Object;

    if (result) {
      return fromPairs(
        Object.entries(result).map(([k, v]) => [k, JSON.parse(v)]),
      );
    }
  }

  /**
   * Get children job keys if this job is a parent and has children.
   *
   * @returns dependencies separated by processed and unprocessed.
   */
  async getDependencies(opts: DependenciesOpts = {}): Promise<{
    nextProcessedCursor?: number;
    processed?: Record<string, any>;
    nextUnprocessedCursor?: number;
    unprocessed?: string[];
  }> {
    const client = await this.queue.client;
    const multi = client.multi();
    if (!opts.processed && !opts.unprocessed) {
      multi.hgetall(this.toKey(`${this.id}:processed`));
      multi.smembers(this.toKey(`${this.id}:dependencies`));

      const [[err1, processed], [err2, unprocessed]] = (await multi.exec()) as [
        [null | Error, { [jobKey: string]: string }],
        [null | Error, string[]],
      ];

      const transformedProcessed = Object.entries(processed).reduce(
        (accumulator, [key, value]) => {
          return { ...accumulator, [key]: JSON.parse(value) };
        },
        {},
      );

      return { processed: transformedProcessed, unprocessed };
    } else {
      const defaultOpts = {
        cursor: 0,
        count: 20,
      };

      if (opts.processed) {
        const processedOpts = Object.assign({ ...defaultOpts }, opts.processed);
        multi.hscan(
          this.toKey(`${this.id}:processed`),
          processedOpts.cursor,
          'COUNT',
          processedOpts.count,
        );
      }

      if (opts.unprocessed) {
        const unprocessedOpts = Object.assign(
          { ...defaultOpts },
          opts.unprocessed,
        );
        multi.sscan(
          this.toKey(`${this.id}:dependencies`),
          unprocessedOpts.cursor,
          'COUNT',
          unprocessedOpts.count,
        );
      }

      const [result1, result2] = await multi.exec();

      const [processedCursor, processed = []] = opts.processed
        ? result1[1]
        : [];
      const [unprocessedCursor, unprocessed = []] = opts.unprocessed
        ? opts.processed
          ? result2[1]
          : result1[1]
        : [];

      const transformedProcessed = processed.reduce(
        (
          accumulator: Record<string, any>,
          currentValue: string,
          index: number,
        ) => {
          if (index % 2) {
            return {
              ...accumulator,
              [processed[index - 1]]: JSON.parse(currentValue),
            };
          }
          return accumulator;
        },
        {},
      );

      return {
        ...(processedCursor
          ? {
              processed: transformedProcessed,
              nextProcessedCursor: Number(processedCursor),
            }
          : {}),
        ...(unprocessedCursor
          ? { unprocessed, nextUnprocessedCursor: Number(unprocessedCursor) }
          : {}),
      };
    }
  }

  /**
   * Get children job counts if this job is a parent and has children.
   *
   * @returns dependencies count separated by processed and unprocessed.
   */
  async getDependenciesCount(
    opts: {
      processed?: boolean;
      unprocessed?: boolean;
    } = {},
  ): Promise<{
    processed?: number;
    unprocessed?: number;
  }> {
    const client = await this.queue.client;
    const multi = client.multi();

    const updatedOpts =
      !opts.processed && !opts.unprocessed
        ? { processed: true, unprocessed: true }
        : opts;

    if (updatedOpts.processed) {
      multi.hlen(this.toKey(`${this.id}:processed`));
    }

    if (updatedOpts.unprocessed) {
      multi.scard(this.toKey(`${this.id}:dependencies`));
    }

    const [[err1, result1] = [], [err2, result2] = []] =
      (await multi.exec()) as [[null | Error, number], [null | Error, number]];

    const processed = updatedOpts.processed ? result1 : undefined;
    const unprocessed = updatedOpts.unprocessed
      ? updatedOpts.processed
        ? result2
        : result1
      : undefined;

    return {
      ...(updatedOpts.processed
        ? {
            processed,
          }
        : {}),
      ...(updatedOpts.unprocessed ? { unprocessed } : {}),
    };
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
      const [status, result] = (await Scripts.isFinished(
        this.queue,
        jobId,
        true,
      )) as [number, string];
      const finished = status != 0;
      if (finished) {
        if (status == -5 || status == 2) {
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
   * @param timestamp - timestamp where the job should be moved back to "wait"
   * @returns
   */
  moveToDelayed(timestamp: number): Promise<void> {
    return Scripts.moveToDelayed(this.queue, this.id, timestamp);
  }

  /**
   * Moves the job to the waiting-children set.
   *
   * @param token - Token to check job is locked by current worker
   * @param opts - The options bag for moving a job to waiting-children.
   * @returns true if the job was moved
   */
  moveToWaitingChildren(
    token: string,
    opts: MoveToChildrenOpts = {},
  ): Promise<boolean | Error> {
    return Scripts.moveToWaitingChildren(this.queue, this.id, token, opts);
  }

  /**
   * Promotes a delayed job so that it starts to be processed as soon as possible.
   */
  async promote(): Promise<void> {
    const queue = this.queue;
    const jobId = this.id;

    const code = await Scripts.promote(queue, jobId);
    if (code < 0) {
      throw Scripts.finishedErrors(code, this.id, 'promote', 'delayed');
    }
  }

  /**
   * Attempts to retry the job. Only a job that has failed or completed can be retried.
   *
   * @param state - completed / failed
   * @returns If resolved and return code is 1, then the queue emits a waiting event
   * otherwise the operation was not a success and throw the corresponding error. If the promise
   * rejects, it indicates that the script failed to execute
   */
  async retry(state: 'completed' | 'failed' = 'failed'): Promise<void> {
    this.failedReason = null;
    this.finishedOn = null;
    this.processedOn = null;
    this.returnvalue = null;

    return Scripts.reprocessJob(this.queue, this, state);
  }

  /**
   * Marks a job to not be retried if it fails (even if attempts has been configured)
   */
  discard(): void {
    this.discarded = true;
  }

  private async isInZSet(set: string): Promise<boolean> {
    const client = await this.queue.client;

    const score = await client.zscore(this.queue.toKey(set), this.id);
    return score !== null;
  }

  private async isInList(list: string): Promise<boolean> {
    return Scripts.isJobInList(this.queue, this.queue.toKey(list), this.id);
  }

  /**
   * Adds the job to Redis.
   *
   * @param client -
   * @param parentOpts -
   * @returns
   */
  addJob(client: RedisClient, parentOpts?: ParentOpts): Promise<string> {
    const queue = this.queue;

    const jobData = this.asJSON();

    const exceedLimit =
      this.opts.sizeLimit &&
      lengthInUtf8Bytes(jobData.data) > this.opts.sizeLimit;

    if (exceedLimit) {
      throw new Error(
        `The size of job ${this.name} exceeds the limit ${this.opts.sizeLimit} bytes`,
      );
    }

    if (this.opts.delay && this.opts.repeat && !this.opts.repeat?.count) {
      throw new Error(`Delay and repeat options could not be used together`);
    }

    return Scripts.addJob(
      client,
      queue,
      jobData,
      this.opts,
      this.id,
      parentOpts,
    );
  }

  private saveStacktrace(multi: Pipeline, err: Error) {
    this.stacktrace = this.stacktrace || [];

    if (err?.stack) {
      this.stacktrace.push(err.stack);
      if (this.opts.stackTraceLimit) {
        this.stacktrace = this.stacktrace.slice(0, this.opts.stackTraceLimit);
      }
    }

    const params = {
      stacktrace: JSON.stringify(this.stacktrace),
      failedReason: err?.message,
    };

    multi.hmset(this.queue.toKey(this.id), params);
  }
}

function getTraces(stacktrace: string[]) {
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
