import { Redis, Pipeline } from 'ioredis';
import { debuglog } from 'util';
import { RetryErrors } from '../enums';
import { BackoffOptions, JobsOptions, WorkerOptions } from '../interfaces';
import { errorObject, isEmpty, tryCatch } from '../utils';
import { Backoffs, QueueBase, QueueEvents } from './';
import { Scripts } from './scripts';

const logger = debuglog('bull');

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
}

export class Job<T = any, R = any> {
  progress: number | object = 0;
  returnvalue: R = null;
  stacktrace: string[] = null;
  timestamp: number;

  attemptsMade = 0;
  failedReason: string;
  finishedOn?: number;
  processedOn?: number;

  private toKey: (type: string) => string;

  private discarded: boolean;

  constructor(
    private queue: QueueBase,
    public name: string,
    public data: T,
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

    this.toKey = queue.toKey.bind(queue);
  }

  static async create<T = any, R = any>(
    queue: QueueBase,
    name: string,
    data: T,
    opts?: JobsOptions,
  ) {
    const client = await queue.client;

    const job = new Job<T, R>(queue, name, data, opts, opts && opts.jobId);

    job.id = await job.addJob(client);

    return job;
  }

  static async createBulk<T = any, R = any>(
    queue: QueueBase,
    jobs: {
      name: string;
      data: T;
      opts?: JobsOptions;
    }[],
  ) {
    const client = await queue.client;

    const jobInstances = jobs.map(
      job => new Job<T, R>(queue, job.name, job.data, job.opts),
    );

    const multi = client.multi();

    for (const job of jobInstances) {
      job.addJob(<Redis>(multi as unknown));
    }

    const result = (await multi.exec()) as [null | Error, string][];
    result.forEach((res, index: number) => {
      const [err, id] = res;
      jobInstances[index].id = id;
    });

    return jobInstances;
  }

  static fromJSON(queue: QueueBase, json: any, jobId?: string) {
    const data = JSON.parse(json.data || '{}');
    const opts = JSON.parse(json.opts || '{}');

    const job = new Job(queue, json.name, data, opts, json.id || jobId);

    job.progress = JSON.parse(json.progress || 0);

    // job.delay = parseInt(json.delay);
    job.timestamp = parseInt(json.timestamp);

    if (json.finishedOn) {
      job.finishedOn = parseInt(json.finishedOn);
    }

    if (json.processedOn) {
      job.processedOn = parseInt(json.processedOn);
    }

    job.failedReason = json.failedReason;
    job.attemptsMade = parseInt(json.attemptsMade || 0);

    job.stacktrace = getTraces(json.stacktrace);

    if (typeof json.returnvalue === 'string') {
      job.returnvalue = getReturnValue(json.returnvalue);
    }

    return job;
  }

  static async fromId(
    queue: QueueBase,
    jobId: string,
  ): Promise<Job | undefined> {
    // jobId can be undefined if moveJob returns undefined
    if (jobId) {
      const client = await queue.client;
      const jobData = await client.hgetall(queue.toKey(jobId));
      return isEmpty(jobData) ? undefined : Job.fromJSON(queue, jobData, jobId);
    }
  }

  toJSON() {
    const { queue, ...withoutQueue } = this;
    return withoutQueue;
  }

  asJSON(): JobJson {
    return {
      id: this.id,
      name: this.name,
      data: JSON.stringify(this.data || {}),
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
  ): Promise<[JobJson, string] | []> {
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

  isCompleted() {
    return this.isInZSet('completed');
  }

  isFailed() {
    return this.isInZSet('failed');
  }

  isDelayed() {
    return this.isInZSet('delayed');
  }

  isActive() {
    return this.isInList('active');
  }

  async isWaiting() {
    return (await this.isInList('wait')) || (await this.isInList('paused'));
  }

  async getState() {
    if (await this.isCompleted()) return 'completed';
    if (await this.isFailed()) return 'failed';
    if (await this.isDelayed()) return 'delayed';
    if (await this.isActive()) return 'active';
    if (await this.isWaiting()) return 'waiting';
    return 'unknown';
  }

  /**
   * Returns a promise the resolves when the job has finished. (completed or failed).
   */
  async waitUntilFinished(queueEvents: QueueEvents, ttl?: number) {
    await this.queue.waitUntilReady();

    const jobId = this.id;
    const status = await Scripts.isFinished(this.queue, jobId);
    const finished = status > 0;
    if (finished) {
      const job = await Job.fromId(this.queue, this.id);
      if (status == 2) {
        throw new Error(job.failedReason);
      } else {
        return job.returnvalue;
      }
    } else {
      return new Promise((resolve, reject) => {
        let timeout: NodeJS.Timeout;
        if (ttl) {
          timeout = setTimeout(() => onFailed('timedout'), ttl);
        }

        function onCompleted(args: any) {
          resolve(args.returnvalue);
          removeListeners();
        }

        function onFailed(args: any) {
          reject(new Error(args.failedReason || args));
          removeListeners();
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
      });
    }
  }

  moveToDelayed(timestamp: number) {
    return Scripts.moveToDelayed(this.queue, this.id, timestamp);
  }

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

  discard() {
    this.discarded = true;
  }

  private async isInZSet(set: string) {
    const client = await this.queue.client;

    const score = await client.zscore(this.queue.toKey(set), this.id);
    return score !== null;
  }

  private async isInList(list: string) {
    return Scripts.isJobInList(
      await this.queue.client,
      this.queue.toKey(list),
      this.id,
    );
  }

  private addJob(client: Redis): string {
    const queue = this.queue;

    const jobData = this.asJSON();

    return Scripts.addJob(client, queue, jobData, this.opts, this.id);
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

function getTraces(stacktrace: any[]) {
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
