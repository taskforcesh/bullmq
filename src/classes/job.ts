import { Pipeline } from 'ioredis';
import { debuglog } from 'util';
import { RetryErrors } from '../enums';
import { BackoffOptions, JobsOptions, WorkerOptions } from '../interfaces';
import { errorObject, isEmpty, lengthInUtf8Bytes, tryCatch } from '../utils';
import { getParentKey } from './flow-producer';
import { QueueEvents } from './queue-events';
import { Backoffs } from './backoffs';
import { MinimalQueue, ParentOpts, Scripts } from './scripts';
import { fromPairs } from 'lodash';
import { RedisClient } from './redis-connection';

const logger = debuglog('bull');

export type BulkJobOptions = Omit<JobsOptions, 'repeat'>;

export interface JobJson {
  id: string;
  name: string;
  data: string;
  opts: string;
  progress: number | object;
  attemptsMade: number;
  finishedOn?: number;
  processedOn?: number;
  timestamp: number;
  failedReason: string;
  stacktrace: string;
  returnvalue: string;
  parentKey?: string;
}

export interface JobJsonRaw {
  id: string;
  name: string;
  data: string;
  opts: string;
  progress: string;
  attemptsMade: string;
  finishedOn?: string;
  processedOn?: string;
  timestamp: string;
  failedReason: string;
  stacktrace: string[];
  returnvalue: string;
  parentKey?: string;
}

export interface MoveToChildrenOpts {
  timestamp?: number;
  child?: {
    id: string;
    queue: string;
  };
}

export class Job<T = any, R = any, N extends string = string> {
  /**
   * The progress a job has performed so far.
   */
  progress: number | object = 0;

  /**
   * The value returned by the processor when processing this job.
   */
  returnvalue: R = null;

  /**
   * Stacktrace for the error (for failed jobs).
   */
  stacktrace: string[] = null;

  /**
   * Timestamp when the job was created (unless overridden with job options).
   */
  timestamp: number;

  /**
   * Number of attempts after the job has failed.
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

  private toKey: (type: string) => string;

  private discarded: boolean;

  constructor(
    private queue: MinimalQueue,
    /**
     * The name of the Job
     */
    public name: N,

    /**
     * The payload for this job.
     */
    public data: T,

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

    this.toKey = queue.toKey.bind(queue);
  }

  /**
   * Creates a new job and adds it to the queue.
   *
   * @param queue the queue where to add the job.
   * @param name  the name of the job.
   * @param data  the payload of the job.
   * @param opts the options bag for this job.
   * @returns
   */
  static async create<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    name: N,
    data: T,
    opts?: JobsOptions,
  ) {
    const client = await queue.client;

    const job = new Job<T, R, N>(queue, name, data, opts, opts && opts.jobId);

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
   * @param queue the queue were to add the jobs.
   * @param jobs an array of jobs to be added to the queue.
   * @returns
   */
  static async createBulk<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    jobs: {
      name: N;
      data: T;
      opts?: BulkJobOptions;
    }[],
  ) {
    const client = await queue.client;

    const jobInstances = jobs.map(
      job =>
        new Job<T, R, N>(queue, job.name, job.data, job.opts, job.opts?.jobId),
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
   * @param queue the queue where the job belongs to.
   * @param json the plain object containing the job.
   * @param jobId an optional job id (overrides the id coming from the JSON object)
   * @returns
   */
  static fromJSON(queue: MinimalQueue, json: JobJsonRaw, jobId?: string) {
    const data = JSON.parse(json.data || '{}');
    const opts = JSON.parse(json.opts || '{}');

    const job = new Job(queue, json.name, data, opts, json.id || jobId);

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

    return job;
  }

  /**
   * Fetches a Job from the queue given the passed job id.
   *
   * @param queue the queue where the job belongs to.
   * @param jobId the job id.
   * @returns
   */
  static async fromId(
    queue: MinimalQueue,
    jobId: string,
  ): Promise<Job | undefined> {
    // jobId can be undefined if moveJob returns undefined
    if (jobId) {
      const client = await queue.client;
      const jobData = await client.hgetall(queue.toKey(jobId));
      return isEmpty(jobData)
        ? undefined
        : Job.fromJSON(queue, (<unknown>jobData) as JobJsonRaw, jobId);
    }
  }

  toJSON() {
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
      opts: JSON.stringify(this.opts),
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
   * Updates a job's data
   *
   * @param data the data that will replace the current jobs data.
   */
  async update(data: T) {
    const client = await this.queue.client;

    this.data = data;
    await client.hset(this.queue.toKey(this.id), 'data', JSON.stringify(data));
  }

  async updateProgress(progress: number | object): Promise<void> {
    this.progress = progress;
    return Scripts.updateProgress(this.queue, this, progress);
  }

  /**
   * Logs one row of log data.
   *
   * @params logRow: string String with log data to be logged.
   *
   */
  async log(logRow: string) {
    const client = await this.queue.client;
    const logsKey = this.toKey(this.id) + ':logs';
    return client.rpush(logsKey, logRow);
  }

  /**
   * Completely remove the job from the queue.
   * Note, this call will throw an exception if the job
   * is being processed when the call is performed.
   */
  async remove() {
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
   * @param token unique token for the lock
   * @param duration lock duration in milliseconds
   */
  async extendLock(token: string, duration: number) {
    return Scripts.extendLock(this.queue, this.id, token, duration);
  }

  /**
   * Moves a job to the completed queue.
   * Returned job to be used with Queue.prototype.nextJobFromJobData.
   * @param returnValue {string} The jobs success message.
   * @param fetchNext {boolean} True when wanting to fetch the next job
   * @returns {Promise} Returns the jobData of the next job in the waiting queue.
   */
  async moveToCompleted(
    returnValue: R,
    token: string,
    fetchNext = true,
  ): Promise<[JobJsonRaw, string] | []> {
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
   * @param err {Error} The jobs error message.
   * @param token {string} Token to check job is locked by current worker
   * @param fetchNext {boolean} True when wanting to fetch the next job
   * @returns void
   */
  async moveToFailed(err: Error, token: string, fetchNext = false) {
    const client = await this.queue.client;

    const queue = this.queue;
    this.failedReason = err.message;

    let command: string;
    const multi = client.multi();
    this.saveAttempt(multi, err);

    //
    // Check if an automatic retry should be performed
    //
    let moveToFailed = false;
    if (this.attemptsMade < this.opts.attempts && !this.discarded) {
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
        err.message,
        this.opts.removeOnFail,
        token,
        fetchNext,
      );
      (<any>multi).moveToFinished(args);
      command = 'failed';
    }

    if (!this.queue.closing) {
      const results = await multi.exec();
      const code = results[results.length - 1][1];
      if (code < 0) {
        throw Scripts.finishedErrors(code, this.id, command);
      }
    }
  }

  /**
   *
   * @returns true if the job has completed.
   */
  isCompleted() {
    return this.isInZSet('completed');
  }

  /**
   *
   * @returns true if the job has failed.
   */
  isFailed() {
    return this.isInZSet('failed');
  }

  /**
   *
   * @returns true if the job is delayed.
   */
  isDelayed() {
    return this.isInZSet('delayed');
  }

  /**
   *
   * @returns true if the job is waiting for children.
   */
  isWaitingChildren() {
    return this.isInZSet('waiting-children');
  }

  /**
   *
   * @returns true of the job is active.
   */
  isActive() {
    return this.isInList('active');
  }

  /**
   *
   * @returns true if the job is waiting.
   */
  async isWaiting() {
    return (await this.isInList('wait')) || (await this.isInList('paused'));
  }

  /**
   * Get current state.
   * @method
   * @returns {string} Returns one of these values:
   * 'completed', 'failed', 'delayed', 'active', 'waiting', 'waiting-children', 'unknown'.
   */
  getState() {
    return Scripts.getState(this.queue, this.id);
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
  async getDependencies() {
    const client = await this.queue.client;

    const multi = client.multi();

    await multi.hgetall(this.toKey(`${this.id}:processed`));
    await multi.smembers(this.toKey(`${this.id}:dependencies`));

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
  }

  /**
   * Returns a promise the resolves when the job has finished. (completed or failed).
   */
  async waitUntilFinished(queueEvents: QueueEvents, ttl?: number): Promise<R> {
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

      queueEvents.on(completedEvent, onCompleted);
      queueEvents.on(failedEvent, onFailed);
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
      const status = await Scripts.isFinished(this.queue, jobId);
      const finished = status > 0;
      if (finished) {
        const job = await Job.fromId(this.queue, this.id);
        if (status == 2) {
          onFailed(job);
        } else {
          onCompleted(job);
        }
      }
    });
  }

  /**
   * Moves the job to the delay set.
   *
   * @param timestamp timestamp where the job should be moved back to "wait"
   * @returns
   */
  moveToDelayed(timestamp: number) {
    return Scripts.moveToDelayed(this.queue, this.id, timestamp);
  }

  /**
   * Moves the job to the waiting-children set.
   * @param {string} token Token to check job is locked by current worker
   * @param opts the options bag for moving a job to waiting-children.
   * @returns {boolean} true if the job was moved
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
  async promote() {
    const queue = this.queue;
    const jobId = this.id;

    const result = await Scripts.promote(queue, jobId);
    if (result === -1) {
      throw new Error('Job ' + jobId + ' is not in a delayed state');
    }
  }

  /**
   * Attempts to retry the job. Only a job that has failed can be retried.
   *
   * @return {Promise} If resolved and return code is 1, then the queue emits a waiting event
   * otherwise the operation was not a success and throw the corresponding error. If the promise
   * rejects, it indicates that the script failed to execute
   */
  async retry(state: 'completed' | 'failed' = 'failed') {
    const client = await this.queue.client;

    this.failedReason = null;
    this.finishedOn = null;
    this.processedOn = null;

    await client.hdel(
      this.queue.toKey(this.id),
      'finishedOn',
      'processedOn',
      'failedReason',
    );

    const result = await Scripts.reprocessJob(this.queue, this, state);
    if (result === 1) {
      return;
    } else if (result === RetryErrors.JobNotExist) {
      throw new Error('Retried job not exist');
    } else if (result === RetryErrors.JobNotFailed) {
      throw new Error('Retried job not failed');
    }
  }

  /**
   * Marks a job to not be retried if it fails (even if attempts has been configured)
   */
  discard() {
    this.discarded = true;
  }

  private async isInZSet(set: string) {
    const client = await this.queue.client;

    const score = await client.zscore(this.queue.toKey(set), this.id);
    return score !== null;
  }

  private async isInList(list: string) {
    return Scripts.isJobInList(this.queue, this.queue.toKey(list), this.id);
  }

  /**
   * Adds the job to Redis.
   *
   * @param client
   * @param parentOpts
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

    return Scripts.addJob(
      client,
      queue,
      jobData,
      this.opts,
      this.id,
      parentOpts,
    );
  }

  private saveAttempt(multi: Pipeline, err: Error) {
    this.attemptsMade++;
    this.stacktrace = this.stacktrace || [];

    this.stacktrace.push(err.stack);
    if (this.opts.stackTraceLimit) {
      this.stacktrace = this.stacktrace.slice(0, this.opts.stackTraceLimit);
    }

    const params = {
      attemptsMade: this.attemptsMade,
      stacktrace: JSON.stringify(this.stacktrace),
      failedReason: err.message,
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
