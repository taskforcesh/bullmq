import {
  BackendFactory,
  BaseJobOptions,
  BulkJobOptions,
  IoredisListener,
  IQueueBackend,
  JobSchedulerJson,
  MinimalQueue,
  QueueOptions,
  RepeatOptions,
} from '../interfaces';
import {
  FinishedStatus,
  JobsOptions,
  JobSchedulerTemplateOptions,
  JobProgress,
} from '../types';
import { Job } from './job';
import { QueueGetters } from './queue-getters';
import { RedisQueueBackend } from './redis-queue-backend';
import { SpanKind, TelemetryAttributes } from '../enums';
import { JobScheduler } from './job-scheduler';
import { version } from '../version';
import { randomUUID } from '../utils';

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

export interface QueueListener<
  JobBase extends Job = Job,
> extends IoredisListener {
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
  progress: (jobId: string, progress: JobProgress) => void;

  /**
   * Listen to 'removed' event.
   *
   * This event is triggered when a job is removed.
   */
  removed: (jobId: string) => void;

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
  waiting: (job: JobBase) => void;
}

/**
 * IsAny<T> A type helper to determine if a given type `T` is `any`.
 * This works by using `any` type with the intersection
 * operator (`&`). If `T` is `any`, then `1 & T` resolves to `any`, and since `0`
 * is assignable to `any`, the conditional type returns `true`.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;
// Helper for JobBase type
type JobBase<T, ResultType, NameType extends string> =
  IsAny<T> extends true
    ? Job<T, ResultType, NameType>
    : T extends Job<any, any, any>
      ? T
      : Job<T, ResultType, NameType>;

// Helper types to extract DataType, ResultType, and NameType
type ExtractDataType<DataTypeOrJob, Default> =
  DataTypeOrJob extends Job<infer D, any, any> ? D : Default;

type ExtractResultType<DataTypeOrJob, Default> =
  DataTypeOrJob extends Job<any, infer R, any> ? R : Default;

type ExtractNameType<DataTypeOrJob, Default extends string> =
  DataTypeOrJob extends Job<any, any, infer N> ? N : Default;

/**
 * Queue
 *
 * This class provides methods to add jobs to a queue and some other high-level
 * administration such as pausing or deleting queues.
 *
 * @typeParam DataType - The type of the data that the job will process.
 * @typeParam ResultType - The type of the result of the job.
 * @typeParam NameType - The type of the name of the job.
 *
 * @example
 *
 * ```typescript
 * import { Queue } from 'bullmq';
 *
 * interface MyDataType {
 *  foo: string;
 * }
 *
 * interface MyResultType {
 *   bar: string;
 * }
 *
 * const queue = new Queue<MyDataType, MyResultType, "blue" | "brown">('myQueue');
 * ```
 */
export class Queue<
  DataTypeOrJob = any,
  DefaultResultType = any,
  DefaultNameType extends string = string,
  DataType = ExtractDataType<DataTypeOrJob, DataTypeOrJob>,
  ResultType = ExtractResultType<DataTypeOrJob, DefaultResultType>,
  NameType extends string = ExtractNameType<DataTypeOrJob, DefaultNameType>,
  B extends IQueueBackend = RedisQueueBackend,
> extends QueueGetters<JobBase<DataTypeOrJob, ResultType, NameType>, B> {
  token = randomUUID();
  jobsOpts: BaseJobOptions;
  declare opts: QueueOptions;

  protected libName = 'bullmq';

  protected _jobScheduler?: JobScheduler;

  constructor(
    name: string,
    opts?: QueueOptions,
    backendFactory?: BackendFactory<B>,
  ) {
    super(
      name,
      {
        ...opts,
      },
      backendFactory,
    );

    this.jobsOpts = opts?.defaultJobOptions ?? {};

    this.waitUntilReady()
      .then(() => {
        if (!this.closing && !opts?.skipMetasUpdate) {
          return this.backend.setQueueMeta(this.metaValues);
        }
      })
      .catch(err => {
        // We ignore this error to avoid warnings. The error can still
        // be received by listening to event 'error'
      });
  }

  emit<U extends keyof QueueListener<JobBase<DataType, ResultType, NameType>>>(
    event: U,
    ...args: Parameters<
      QueueListener<JobBase<DataType, ResultType, NameType>>[U]
    >
  ): boolean {
    return super.emit(event, ...args);
  }

  off<U extends keyof QueueListener<JobBase<DataType, ResultType, NameType>>>(
    eventName: U,
    listener: QueueListener<JobBase<DataType, ResultType, NameType>>[U],
  ): this {
    super.off(eventName, listener);
    return this;
  }

  on<U extends keyof QueueListener<JobBase<DataType, ResultType, NameType>>>(
    event: U,
    listener: QueueListener<JobBase<DataType, ResultType, NameType>>[U],
  ): this {
    super.on(event, listener);
    return this;
  }

  once<U extends keyof QueueListener<JobBase<DataType, ResultType, NameType>>>(
    event: U,
    listener: QueueListener<JobBase<DataType, ResultType, NameType>>[U],
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
      version: `${this.libName}:${version}`,
    };
  }

  /**
   * Get library version.
   *
   * @returns the content of the meta.library field.
   */
  async getVersion(): Promise<string> {
    return await this.backend.getQueueMetaField('version');
  }

  get jobScheduler(): Promise<JobScheduler> {
    return new Promise<JobScheduler>(async resolve => {
      if (!this._jobScheduler) {
        // Share this queue's backend (same queue name/keys) with the scheduler.
        this._jobScheduler = new JobScheduler(
          this.name,
          this.opts,
          () => this.backend,
        );
        this._jobScheduler.on('error', this.emit.bind(this, 'error'));
      }
      resolve(this._jobScheduler);
    });
  }

  /**
   * Enable and set global concurrency value.
   * @param concurrency - Maximum number of simultaneous jobs that the workers can handle.
   * For instance, setting this value to 1 ensures that no more than one job
   * is processed at any given time. If this limit is not defined, there will be no
   * restriction on the number of concurrent jobs.
   */
  async setGlobalConcurrency(concurrency: number) {
    return this.backend.setQueueMeta({ concurrency });
  }

  /**
   * Enable and set rate limit.
   * @param max - Max number of jobs to process in the time period specified in `duration`
   * @param duration - Time in milliseconds. During this time, a maximum of `max` jobs will be processed.
   */
  async setGlobalRateLimit(max: number, duration: number) {
    return this.backend.setQueueMeta({ max, duration });
  }

  /**
   * Remove global concurrency value.
   */
  async removeGlobalConcurrency() {
    return this.backend.removeQueueMetaFields(['concurrency']);
  }

  /**
   * Remove global rate limit values.
   */
  async removeGlobalRateLimit() {
    return this.backend.removeQueueMetaFields(['max', 'duration']);
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
    return this.trace<Job<DataType, ResultType, NameType>>(
      SpanKind.PRODUCER,
      'add',
      `${this.name}.${name}`,
      async (span, srcPropagationMetadata) => {
        if (srcPropagationMetadata && !opts?.telemetry?.omitContext) {
          const telemetry = {
            metadata: srcPropagationMetadata,
          };
          opts = { ...opts, telemetry };
        }

        const job = await this.addJob(name, data, opts);

        span?.setAttributes({
          [TelemetryAttributes.JobName]: name,
          [TelemetryAttributes.JobId]: job.id,
        });

        return job;
      },
    );
  }

  /**
   * addJob is a telemetry free version of the add method, useful in order to wrap it
   * with custom telemetry on subclasses.
   *
   * @param name - Name of the job to be added to the queue.
   * @param data - Arbitrary data to append to the job.
   * @param opts - Job options that affects how the job is going to be processed.
   *
   * @returns Job
   */
  protected async addJob(
    name: NameType,
    data: DataType,
    opts?: JobsOptions,
  ): Promise<Job<DataType, ResultType, NameType>> {
    const jobId = opts?.jobId;

    if (jobId == '0' || jobId?.startsWith('0:')) {
      throw new Error("JobId cannot be '0' or start with '0:'");
    }

    const mergedOpts = {
      ...this.jobsOpts,
      ...opts,
      jobId,
    };

    const job = await this.Job.create<DataType, ResultType, NameType>(
      this as MinimalQueue,
      name,
      data,
      mergedOpts,
    );
    this.emit('waiting', job as JobBase<DataType, ResultType, NameType>);

    return job;
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
    return this.trace<Job<DataType, ResultType, NameType>[]>(
      SpanKind.PRODUCER,
      'addBulk',
      this.name,
      async (span, srcPropagationMetadata) => {
        if (span) {
          span.setAttributes({
            [TelemetryAttributes.BulkNames]: jobs.map(job => job.name),
            [TelemetryAttributes.BulkCount]: jobs.length,
          });
        }

        return await this.Job.createBulk<DataType, ResultType, NameType>(
          this as MinimalQueue,
          jobs.map(job => {
            let telemetry = job.opts?.telemetry;
            if (srcPropagationMetadata) {
              const omitContext = job.opts?.telemetry?.omitContext;
              const telemetryMetadata =
                job.opts?.telemetry?.metadata ||
                (!omitContext && srcPropagationMetadata);

              if (telemetryMetadata || omitContext) {
                telemetry = {
                  metadata: telemetryMetadata,
                  omitContext,
                };
              }
            }

            const mergedOpts = {
              ...this.jobsOpts,
              ...job.opts,
              jobId: job.opts?.jobId,
              telemetry,
            };

            return {
              name: job.name,
              data: job.data,
              opts: mergedOpts,
            };
          }),
        );
      },
    );
  }

  /**
   * Upserts a scheduler.
   *
   * A scheduler is a job factory that creates jobs at a given interval.
   * Upserting a scheduler will create a new job scheduler or update an existing one.
   * It will also create the first job based on the repeat options and delayed accordingly.
   *
   * @param key - Unique key for the repeatable job meta.
   * @param repeatOpts - Repeat options
   * @param jobTemplate - Job template. If provided it will be used for all the jobs
   * created by the scheduler.
   *
   * @returns The next job to be scheduled (would normally be in delayed state).
   */
  async upsertJobScheduler(
    jobSchedulerId: NameType,
    repeatOpts: Omit<RepeatOptions, 'key'>,
    jobTemplate?: {
      name?: NameType;
      data?: DataType;
      opts?: JobSchedulerTemplateOptions;
    },
  ) {
    if (repeatOpts.endDate) {
      if (+new Date(repeatOpts.endDate) < Date.now()) {
        throw new Error('End date must be greater than current timestamp');
      }
    }

    return (await this.jobScheduler).upsertJobScheduler<
      DataType,
      ResultType,
      NameType
    >(
      jobSchedulerId,
      repeatOpts,
      jobTemplate?.name ?? jobSchedulerId,
      jobTemplate?.data ?? <DataType>{},
      { ...this.jobsOpts, ...jobTemplate?.opts },
      { override: true },
    );
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
    await this.trace<void>(SpanKind.INTERNAL, 'pause', this.name, async () => {
      await this.backend.pause(true);

      this.emit('paused');
    });
  }

  /**
   * Close the queue instance.
   *
   */
  async close(): Promise<void> {
    await this.trace<void>(SpanKind.INTERNAL, 'close', this.name, async () => {
      await super.close();
    });
  }

  /**
   * Overrides the rate limit to be active for the next jobs.
   *
   * @param expireTimeMs - expire time in ms of this rate limit.
   */
  async rateLimit(expireTimeMs: number): Promise<void> {
    await this.trace<void>(
      SpanKind.INTERNAL,
      'rateLimit',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.QueueRateLimit]: expireTimeMs,
        });

        await this.backend.setRateLimit(expireTimeMs);
      },
    );
  }

  /**
   * Resumes the processing of this queue globally.
   *
   * The method reverses the pause operation by resuming the processing of the
   * queue.
   */
  async resume(): Promise<void> {
    await this.trace<void>(SpanKind.INTERNAL, 'resume', this.name, async () => {
      await this.backend.pause(false);

      this.emit('resumed');
    });
  }

  /**
   * Returns true if the queue is currently paused.
   */
  async isPaused(): Promise<boolean> {
    return this.backend.hasQueueMetaField('paused');
  }

  /**
   * Returns true if the queue is currently maxed.
   */
  isMaxed(): Promise<boolean> {
    return this.backend.isMaxed();
  }

  /**
   * Get Job Scheduler by id
   *
   * @param id - identifier of scheduler.
   */
  async getJobScheduler(
    id: string,
  ): Promise<JobSchedulerJson<DataType> | undefined> {
    return (await this.jobScheduler).getScheduler<DataType>(id);
  }

  /**
   * Get all Job Schedulers
   *
   * @param start - Offset of first scheduler to return.
   * @param end - Offset of last scheduler to return.
   * @param asc - Determine the order in which schedulers are returned based on their
   * next execution time.
   */
  async getJobSchedulers(
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<JobSchedulerJson<DataType>[]> {
    return (await this.jobScheduler).getJobSchedulers<DataType>(
      start,
      end,
      asc,
    );
  }

  /**
   *
   * Get the number of job schedulers.
   *
   * @returns The number of job schedulers.
   */
  async getJobSchedulersCount(): Promise<number> {
    return (await this.jobScheduler).getSchedulersCount();
  }

  /**
   *
   * Removes a job scheduler.
   *
   * @param jobSchedulerId - identifier of the job scheduler.
   *
   * @returns
   */
  async removeJobScheduler(jobSchedulerId: string): Promise<boolean> {
    const jobScheduler = await this.jobScheduler;
    const removed = await jobScheduler.removeJobScheduler(jobSchedulerId);

    return !removed;
  }

  /**
   * Removes a debounce key.
   * @deprecated use removeDeduplicationKey
   *
   * @param id - debounce identifier
   */
  async removeDebounceKey(id: string): Promise<number> {
    return this.trace<number>(
      SpanKind.INTERNAL,
      'removeDebounceKey',
      `${this.name}`,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.JobKey]: id,
        });

        return await this.backend.deleteDeduplicationKey(id);
      },
    );
  }

  /**
   * Removes a deduplication key.
   *
   * @param id - identifier
   */
  async removeDeduplicationKey(id: string): Promise<number> {
    return this.trace<number>(
      SpanKind.INTERNAL,
      'removeDeduplicationKey',
      `${this.name}`,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.DeduplicationKey]: id,
        });

        return this.backend.deleteDeduplicationKey(id);
      },
    );
  }

  /**
   * Removes rate limit key.
   */
  async removeRateLimitKey(): Promise<number> {
    return this.backend.removeRateLimitKey();
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
    return this.trace<number>(
      SpanKind.INTERNAL,
      'remove',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.JobId]: jobId,
          [TelemetryAttributes.JobOptions]: JSON.stringify({
            removeChildren,
          }),
        });

        const code = await this.backend.remove(jobId, removeChildren);

        if (code === 1) {
          this.emit('removed', jobId);
        }

        return code;
      },
    );
  }

  /**
   * Updates the given job's progress.
   *
   * @param jobId - The id of the job to update
   * @param progress - Number or object to be saved as progress.
   */
  async updateJobProgress(jobId: string, progress: JobProgress): Promise<void> {
    await this.trace<void>(
      SpanKind.INTERNAL,
      'updateJobProgress',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.JobId]: jobId,
          [TelemetryAttributes.JobProgress]: JSON.stringify(progress),
        });

        await this.backend.updateProgress(jobId, progress);

        this.emit('progress', jobId, progress);
      },
    );
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
    await this.trace<void>(
      SpanKind.INTERNAL,
      'drain',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.QueueDrainDelay]: delayed,
        });

        await this.backend.drain(delayed);
      },
    );
  }

  /**
   * Cleans jobs from a queue. Similar to drain but keeps jobs within a certain
   * grace period.
   *
   * @param grace - The grace period in milliseconds
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
      | 'waiting'
      | 'active'
      | 'paused'
      | 'prioritized'
      | 'delayed'
      | 'failed' = 'completed',
  ): Promise<string[]> {
    return this.trace<string[]>(
      SpanKind.INTERNAL,
      'clean',
      this.name,
      async span => {
        const maxCount = limit || Infinity;
        const maxCountPerCall = Math.min(10000, maxCount);
        const timestamp = Date.now() - grace;
        let deletedCount = 0;
        const deletedJobsIds: string[] = [];

        // Normalize 'waiting' to 'wait' for consistency with internal Redis keys
        const normalizedType = type === 'waiting' ? 'wait' : type;

        while (deletedCount < maxCount) {
          const jobsIds = await this.backend.cleanJobsInSet(
            normalizedType,
            timestamp,
            maxCountPerCall,
          );

          this.emit('cleaned', jobsIds, normalizedType);
          deletedCount += jobsIds.length;
          deletedJobsIds.push(...jobsIds);

          if (jobsIds.length < maxCountPerCall) {
            break;
          }
        }

        span?.setAttributes({
          [TelemetryAttributes.QueueGrace]: grace,
          [TelemetryAttributes.JobType]: type,
          [TelemetryAttributes.QueueCleanLimit]: maxCount,
          [TelemetryAttributes.JobIds]: deletedJobsIds,
        });

        return deletedJobsIds;
      },
    );
  }

  /**
   * Completely destroys the queue and all of its contents irreversibly.
   * This method will *pause* the queue and requires that there are no
   * active jobs. It is possible to bypass this requirement, i.e. not
   * having active jobs using the "force" option.
   *
   * Note: This operation requires to iterate on all the jobs stored in the queue
   * and can be slow for very large queues.
   *
   * @param opts - Obliterate options.
   */
  async obliterate(opts?: ObliterateOpts): Promise<void> {
    await this.trace<void>(
      SpanKind.INTERNAL,
      'obliterate',
      this.name,
      async () => {
        await this.pause();

        let cursor = 0;
        do {
          cursor = await this.backend.obliterate({
            force: false,
            count: 1000,
            ...opts,
          });
        } while (cursor);
      },
    );
  }

  /**
   * Retry all the failed or completed jobs.
   *
   * @param opts - An object with the following properties:
   *   - count  number to limit how many jobs will be moved to wait status per iteration,
   *   - state  failed by default or completed.
   *   - timestamp from which timestamp to start moving jobs to wait status, default Date.now().
   *
   * @returns
   */
  async retryJobs(
    opts: { count?: number; state?: FinishedStatus; timestamp?: number } = {},
  ): Promise<void> {
    await this.trace<void>(
      SpanKind.PRODUCER,
      'retryJobs',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.QueueOptions]: JSON.stringify(opts),
        });

        let cursor = 0;
        do {
          cursor = await this.backend.retryJobs(
            opts.state,
            opts.count,
            opts.timestamp,
          );
        } while (cursor);
      },
    );
  }

  /**
   * Promote all the delayed jobs.
   *
   * @param opts - An object with the following properties:
   *   - count  number to limit how many jobs will be moved to wait status per iteration
   *
   * @returns
   */
  async promoteJobs(opts: { count?: number } = {}): Promise<void> {
    await this.trace<void>(
      SpanKind.INTERNAL,
      'promoteJobs',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.QueueOptions]: JSON.stringify(opts),
        });

        let cursor = 0;
        do {
          cursor = await this.backend.promoteJobs(opts.count);
        } while (cursor);
      },
    );
  }

  /**
   * Trim the event stream to an approximately maxLength.
   *
   * @param maxLength - The approximate maximum length, or target length, of the event stream.
   */
  async trimEvents(maxLength: number): Promise<number> {
    return this.trace<number>(
      SpanKind.INTERNAL,
      'trimEvents',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.QueueEventMaxLength]: maxLength,
        });

        return await this.backend.trimEvents(maxLength);
      },
    );
  }

  /**
   * Delete old priority helper key.
   */
  async removeDeprecatedPriorityKey(): Promise<number> {
    return this.backend.removeDeprecatedPriorityKey();
  }

  /**
   * Removes orphaned job keys that are stored in the backend but are not
   * referenced in any queue state set.
   *
   * Orphaned keys can occur in rare cases when the removal-by-max-age logic
   * removes state entries without fully cleaning up the corresponding job
   * data (a regression introduced in v5.66.6 via #3694).
   * Under normal operation this method is
   * **not needed** — it is provided only as a one-time migration helper for
   * users who were affected by that specific bug and want to reclaim the
   * leaked storage.
   *
   * How the scan is performed (its atomicity, batching and how the queue's
   * state keys are discovered) is an implementation detail of the underlying
   * backend.
   *
   * @param count - Approximate number of keys to scan per iteration (default 1000).
   * @param limit - Maximum number of orphaned jobs to remove (0 = unlimited).
   *   When set, the method returns as soon as the limit is reached.
   *   Users with a very large number of orphans can call this method
   *   in a loop: `while (await queue.removeOrphanedJobs(1000, 10000)) {}`
   * @returns The total number of orphaned jobs that were removed.
   */
  async removeOrphanedJobs(count = 1000, limit = 0): Promise<number> {
    return this.backend.removeOrphanedJobs(count, limit);
  }
}
