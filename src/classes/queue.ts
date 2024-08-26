import { v4 } from 'uuid';
import {
  BaseJobOptions,
  BulkJobOptions,
  IoredisListener,
  QueueOptions,
  RepeatableJob,
  RepeatOptions,
  Tracer,
} from '../interfaces';
import { FinishedStatus, JobsOptions, MinimalQueue } from '../types';
import { Job } from './job';
import { QueueGetters } from './queue-getters';
import { Repeat } from './repeat';
import { RedisConnection } from './redis-connection';
import { TelemetryAttributes } from '../enums';

export interface ObliterateOpts {
  /**
   * Use force = true to force obliteration even with active jobs in the queue
   * @defaultValue false
   */
  force?: boolean;
  /**
   * Use count with the maximum number of deleted keys per iteration
   * @defaultValue 1000
   */
  count?: number;
}

export interface QueueListener<DataType, ResultType, NameType extends string>
  extends IoredisListener {
  /**
   * Listen to 'cleaned' event.
   *
   * This event is triggered when the queue calls clean method.
   */
  cleaned: (jobs: string[], type: string) => void;

  /**
   * Listen to 'error' event.
   *
   * This event is triggered when an error is thrown.
   */
  error: (err: Error) => void;

  /**
   * Listen to 'paused' event.
   *
   * This event is triggered when the queue is paused.
   */
  paused: () => void;

  /**
   * Listen to 'progress' event.
   *
   * This event is triggered when the job updates its progress.
   */
  progress: (
    job: Job<DataType, ResultType, NameType>,
    progress: number | object,
  ) => void;

  /**
   * Listen to 'removed' event.
   *
   * This event is triggered when a job is removed.
   */
  removed: (job: Job<DataType, ResultType, NameType>) => void;

  /**
   * Listen to 'resumed' event.
   *
   * This event is triggered when the queue is resumed.
   */
  resumed: () => void;

  /**
   * Listen to 'waiting' event.
   *
   * This event is triggered when the queue creates a new job.
   */
  waiting: (job: Job<DataType, ResultType, NameType>) => void;
}

/**
 * Queue
 *
 * This class provides methods to add jobs to a queue and some other high-level
 * administration such as pausing or deleting queues.
 *
 */
export class Queue<
  DataType = any,
  ResultType = any,
  NameType extends string = string,
> extends QueueGetters<DataType, ResultType, NameType> {
  token = v4();
  jobsOpts: BaseJobOptions;
  opts: QueueOptions;
  private _repeat?: Repeat;
  private tracer: Tracer | undefined;

  constructor(
    name: string,
    opts?: QueueOptions,
    Connection?: typeof RedisConnection,
  ) {
    super(
      name,
      {
        blockingConnection: false,
        ...opts,
      },
      Connection,
    );

    this.jobsOpts = opts?.defaultJobOptions ?? {};

    this.tracer = opts?.telemetry?.tracer;

    this.waitUntilReady()
      .then(client => {
        if (!this.closing) {
          client.hmset(this.keys.meta, this.metaValues);
        }
      })
      .catch(err => {
        // We ignore this error to avoid warnings. The error can still
        // be received by listening to event 'error'
      });
  }

  emit<U extends keyof QueueListener<DataType, ResultType, NameType>>(
    event: U,
    ...args: Parameters<QueueListener<DataType, ResultType, NameType>[U]>
  ): boolean {
    return super.emit(event, ...args);
  }

  off<U extends keyof QueueListener<DataType, ResultType, NameType>>(
    eventName: U,
    listener: QueueListener<DataType, ResultType, NameType>[U],
  ): this {
    super.off(eventName, listener);
    return this;
  }

  on<U extends keyof QueueListener<DataType, ResultType, NameType>>(
    event: U,
    listener: QueueListener<DataType, ResultType, NameType>[U],
  ): this {
    super.on(event, listener);
    return this;
  }

  once<U extends keyof QueueListener<DataType, ResultType, NameType>>(
    event: U,
    listener: QueueListener<DataType, ResultType, NameType>[U],
  ): this {
    super.once(event, listener);
    return this;
  }

  /**
   * Returns this instance current default job options.
   */
  get defaultJobOptions(): JobsOptions {
    return { ...this.jobsOpts };
  }

  get metaValues(): Record<string, string | number> {
    return {
      'opts.maxLenEvents': this.opts?.streams?.events?.maxLen ?? 10000,
    };
  }

  get repeat(): Promise<Repeat> {
    return new Promise<Repeat>(async resolve => {
      if (!this._repeat) {
        this._repeat = new Repeat(this.name, {
          ...this.opts,
          connection: await this.client,
        });
        this._repeat.on('error', e => this.emit.bind(this, e));
      }
      resolve(this._repeat);
    });
  }

  /**
   * Get global concurrency value.
   * Returns null in case no value is set.
   */
  async getGlobalConcurrency(): Promise<number | null> {
    const client = await this.client;
    const concurrency = await client.hget(this.keys.meta, 'concurrency');
    if (concurrency) {
      return Number(concurrency);
    }
    return null;
  }

  /**
   * Enable and set global concurrency value.
   * @param concurrency - Maximum number of simultaneous jobs that the workers can handle.
   * For instance, setting this value to 1 ensures that no more than one job
   * is processed at any given time. If this limit is not defined, there will be no
   * restriction on the number of concurrent jobs.
   */
  async setGlobalConcurrency(concurrency: number) {
    const client = await this.client;
    return client.hset(this.keys.meta, 'concurrency', concurrency);
  }

  /**
   * Adds a new job to the queue.
   *
   * @param name - Name of the job to be added to the queue.
   * @param data - Arbitrary data to append to the job.
   * @param opts - Job options that affects how the job is going to be processed.
   */
  async add(
    name: NameType,
    data: DataType,
    opts?: JobsOptions,
  ): Promise<Job<DataType, ResultType, NameType>> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name}.${name} Queue.add`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
      });
    }

    if (opts && opts.repeat) {
      if (opts.repeat.endDate) {
        if (+new Date(opts.repeat.endDate) < Date.now()) {
          throw new Error('End date must be greater than current timestamp');
        }
      }

      const repeatableJob = (await this.repeat).addNextRepeatableJob<
        DataType,
        ResultType,
        NameType
      >(name, data, { ...this.jobsOpts, ...opts }, true);

      if (this.tracer) {
        span.end();
      }

      return repeatableJob;
    } else {
      const jobId = opts?.jobId;

      if (jobId == '0' || jobId?.startsWith('0:')) {
        throw new Error("JobId cannot be '0' or start with 0:");
      }

      const job = await this.Job.create<DataType, ResultType, NameType>(
        this as MinimalQueue,
        name,
        data,
        {
          ...this.jobsOpts,
          ...opts,
          jobId,
        },
      );
      this.emit('waiting', job);

      if (this.tracer) {
        span.setAttributes({
          [TelemetryAttributes.JobId]: job.id,
        });

        span.end();
      }

      return job;
    }
  }

  /**
   * Adds an array of jobs to the queue. This method may be faster than adding
   * one job at a time in a sequence.
   *
   * @param jobs - The array of jobs to add to the queue. Each job is defined by 3
   * properties, 'name', 'data' and 'opts'. They follow the same signature as 'Queue.add'.
   */
  async addBulk(
    jobs: { name: NameType; data: DataType; opts?: BulkJobOptions }[],
  ): Promise<Job<DataType, ResultType, NameType>[]> {
    let span;
    if (this.tracer) {
      const jobsInBulk = jobs.map(job => job.name);
      const spanName = `${this.name} Queue.addBulk`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
        [TelemetryAttributes.BulkNames]: jobsInBulk,
        [TelemetryAttributes.BulkCount]: jobsInBulk.length,
      });
    }

    const bulk = await this.Job.createBulk<DataType, ResultType, NameType>(
      this as MinimalQueue,
      jobs.map(job => ({
        name: job.name,
        data: job.data,
        opts: {
          ...this.jobsOpts,
          ...job.opts,
          jobId: job.opts?.jobId,
        },
      })),
    );

    if (this.tracer) {
      span.end();
    }

    return bulk;
  }

  /**
   * Pauses the processing of this queue globally.
   *
   * We use an atomic RENAME operation on the wait queue. Since
   * we have blocking calls with BRPOPLPUSH on the wait queue, as long as the queue
   * is renamed to 'paused', no new jobs will be processed (the current ones
   * will run until finalized).
   *
   * Adding jobs requires a LUA script to check first if the paused list exist
   * and in that case it will add it there instead of the wait list.
   */
  async pause(): Promise<void> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} Queue.pause`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
      });
    }

    await this.scripts.pause(true);

    if (this.tracer) {
      span.end();
    }

    this.emit('paused');
  }

  /**
   * Close the queue instance.
   *
   */
  async close(): Promise<void> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} Queue.close`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
      });
    }

    if (!this.closing) {
      if (this._repeat) {
        await this._repeat.close();
      }
    }

    await super.close();

    if (this.tracer) {
      span.end();
    }
  }
  /**
   * Resumes the processing of this queue globally.
   *
   * The method reverses the pause operation by resuming the processing of the
   * queue.
   */
  async resume(): Promise<void> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} Queue.resume`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
      });
    }

    await this.scripts.pause(false);

    if (this.tracer) {
      span.end();
    }

    this.emit('resumed');
  }

  /**
   * Returns true if the queue is currently paused.
   */
  async isPaused(): Promise<boolean> {
    const client = await this.client;
    const pausedKeyExists = await client.hexists(this.keys.meta, 'paused');
    return pausedKeyExists === 1;
  }

  /**
   * Returns true if the queue is currently maxed.
   */
  isMaxed(): Promise<boolean> {
    return this.scripts.isMaxed();
  }

  /**
   * Get all repeatable meta jobs.
   *
   * @param start - Offset of first job to return.
   * @param end - Offset of last job to return.
   * @param asc - Determine the order in which jobs are returned based on their
   * next execution time.
   */
  async getRepeatableJobs(
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<RepeatableJob[]> {
    return (await this.repeat).getRepeatableJobs(start, end, asc);
  }

  /**
   * Removes a repeatable job.
   *
   * Note: you need to use the exact same repeatOpts when deleting a repeatable job
   * than when adding it.
   *
   * @see removeRepeatableByKey
   *
   * @param name - Job name
   * @param repeatOpts -
   * @param jobId -
   * @returns
   */
  async removeRepeatable(
    name: NameType,
    repeatOpts: RepeatOptions,
    jobId?: string,
  ): Promise<boolean> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} ${name} Queue.removeRepeatable`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
      });
    }

    const repeat = await this.repeat;
    const removed = await repeat.removeRepeatable(name, repeatOpts, jobId);

    if (this.tracer) {
      span.end();
    }

    return !removed;
  }

  /**
   * Removes a debounce key.
   *
   * @param id - identifier
   */
  async removeDebounceKey(id: string): Promise<number> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} ${id} Queue.removeDebounceKey`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
      });
    }

    const client = await this.client;

    const debounced = await client.del(`${this.keys.de}:${id}`);

    if (this.tracer) {
      span.end();
    }

    return debounced;
  }

  /**
   * Removes a repeatable job by its key. Note that the key is the one used
   * to store the repeatable job metadata and not one of the job iterations
   * themselves. You can use "getRepeatableJobs" in order to get the keys.
   *
   * @see getRepeatableJobs
   *
   * @param repeatJobKey - To the repeatable job.
   * @returns
   */
  async removeRepeatableByKey(key: string): Promise<boolean> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} ${key} Queue.removeRepeatableByKey`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
        [TelemetryAttributes.JobKey]: key,
      });
    }

    const repeat = await this.repeat;
    const removed = await repeat.removeRepeatableByKey(key);

    if (this.tracer) {
      span.end();
    }

    return !removed;
  }

  /**
   * Removes the given job from the queue as well as all its
   * dependencies.
   *
   * @param jobId - The id of the job to remove
   * @param opts - Options to remove a job
   * @returns 1 if it managed to remove the job or 0 if the job or
   * any of its dependencies were locked.
   */
  async remove(jobId: string, { removeChildren = true } = {}): Promise<number> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} ${jobId} Queue.remove`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
        [TelemetryAttributes.JobId]: jobId,
        [TelemetryAttributes.JobOptions]: JSON.stringify({
          removeChildren,
        }),
      });
    }

    const status = await this.scripts.remove(jobId, removeChildren);

    if (this.tracer) {
      span.end();
    }

    return status;
  }

  /**
   * Updates the given job's progress.
   *
   * @param jobId - The id of the job to update
   * @param progress - Number or object to be saved as progress.
   */
  async updateJobProgress(
    jobId: string,
    progress: number | object,
  ): Promise<void> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} Queue.updateJobProgress`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
        [TelemetryAttributes.JobId]: jobId,
        [TelemetryAttributes.JobProgress]: JSON.stringify(progress),
      });
    }

    await this.scripts.updateProgress(jobId, progress);

    if (this.tracer) {
      span.end();
    }
  }

  /**
   * Logs one row of job's log data.
   *
   * @param jobId - The job id to log against.
   * @param logRow - String with log data to be logged.
   * @param keepLogs - Max number of log entries to keep (0 for unlimited).
   *
   * @returns The total number of log entries for this job so far.
   */
  async addJobLog(
    jobId: string,
    logRow: string,
    keepLogs?: number,
  ): Promise<number> {
    return Job.addJobLog(this, jobId, logRow, keepLogs);
  }

  /**
   * Drains the queue, i.e., removes all jobs that are waiting
   * or delayed, but not active, completed or failed.
   *
   * @param delayed - Pass true if it should also clean the
   * delayed jobs.
   */
  async drain(delayed = false): Promise<void> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} Queue.drain`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
        [TelemetryAttributes.QueueDrainDelay]: delayed,
      });
    }

    await this.scripts.drain(delayed);

    if (this.tracer) {
      span.end();
    }
  }

  /**
   * Cleans jobs from a queue. Similar to drain but keeps jobs within a certain
   * grace period.
   *
   * @param grace - The grace period
   * @param limit - Max number of jobs to clean
   * @param type - The type of job to clean
   * Possible values are completed, wait, active, paused, delayed, failed. Defaults to completed.
   * @returns Id jobs from the deleted records
   */
  async clean(
    grace: number,
    limit: number,
    type:
      | 'completed'
      | 'wait'
      | 'active'
      | 'paused'
      | 'prioritized'
      | 'delayed'
      | 'failed' = 'completed',
  ): Promise<string[]> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} Queue.clean`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
        [TelemetryAttributes.QueueGrace]: grace,
        [TelemetryAttributes.JobType]: type,
      });
    }

    const maxCount = limit || Infinity;
    const maxCountPerCall = Math.min(10000, maxCount);
    const timestamp = Date.now() - grace;
    let deletedCount = 0;
    const deletedJobsIds: string[] = [];

    if (this.tracer) {
      span.setAttributes({
        [TelemetryAttributes.QueueCleanLimit]: maxCount,
        [TelemetryAttributes.JobTimestamp]: timestamp,
      });
    }

    while (deletedCount < maxCount) {
      const jobsIds = await this.scripts.cleanJobsInSet(
        type,
        timestamp,
        maxCountPerCall,
      );

      this.emit('cleaned', jobsIds, type);
      deletedCount += jobsIds.length;
      deletedJobsIds.push(...jobsIds);

      if (jobsIds.length < maxCountPerCall) {
        break;
      }
    }

    if (this.tracer) {
      span.setAttributes({
        [TelemetryAttributes.JobId]: deletedJobsIds,
      });

      span.end();
    }

    return deletedJobsIds;
  }

  /**
   * Completely destroys the queue and all of its contents irreversibly.
   * This method will the *pause* the queue and requires that there are no
   * active jobs. It is possible to bypass this requirement, i.e. not
   * having active jobs using the "force" option.
   *
   * Note: This operation requires to iterate on all the jobs stored in the queue
   * and can be slow for very large queues.
   *
   * @param opts - Obliterate options.
   */
  async obliterate(opts?: ObliterateOpts): Promise<void> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} Queue.obliterate`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
      });
    }

    await this.pause();

    let cursor = 0;
    do {
      cursor = await this.scripts.obliterate({
        force: false,
        count: 1000,
        ...opts,
      });
    } while (cursor);

    if (this.tracer) {
      span.end();
    }
  }

  /**
   * Retry all the failed or completed jobs.
   *
   * @param opts: { count: number; state: FinishedStatus; timestamp: number}
   *   - count  number to limit how many jobs will be moved to wait status per iteration,
   *   - state  failed by default or completed.
   *   - timestamp from which timestamp to start moving jobs to wait status, default Date.now().
   *
   * @returns
   */
  async retryJobs(
    opts: { count?: number; state?: FinishedStatus; timestamp?: number } = {},
  ): Promise<void> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} Queue.retryJobs`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
        [TelemetryAttributes.QueueOptions]: JSON.stringify(opts),
      });
    }

    let cursor = 0;
    do {
      cursor = await this.scripts.retryJobs(
        opts.state,
        opts.count,
        opts.timestamp,
      );
    } while (cursor);

    if (this.tracer) {
      span.end();
    }
  }

  /**
   * Promote all the delayed jobs.
   *
   * @param opts: { count: number }
   *   - count  number to limit how many jobs will be moved to wait status per iteration
   *
   * @returns
   */
  async promoteJobs(opts: { count?: number } = {}): Promise<void> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} Queue.promoteJobs`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
        [TelemetryAttributes.QueueOptions]: JSON.stringify(opts),
      });
    }

    let cursor = 0;
    do {
      cursor = await this.scripts.promoteJobs(opts.count);
    } while (cursor);

    if (this.tracer) {
      span.end();
    }
  }

  /**
   * Trim the event stream to an approximately maxLength.
   *
   * @param maxLength -
   */
  async trimEvents(maxLength: number): Promise<number> {
    let span;
    if (this.tracer) {
      const spanName = `${this.name} Queue.trimEvents`;
      span = this.tracer.startSpan(spanName);
      span.setAttributes({
        [TelemetryAttributes.QueueName]: this.name,
        [TelemetryAttributes.QueueEventMaxLength]: maxLength,
      });
    }

    const client = await this.client;
    const trim = await client.xtrim(this.keys.events, 'MAXLEN', '~', maxLength);

    if (this.tracer) {
      span.end();
    }

    return trim;
  }

  /**
   * Delete old priority helper key.
   */
  async removeDeprecatedPriorityKey(): Promise<number> {
    const client = await this.client;
    return client.del(this.toKey('priority'));
  }
}
