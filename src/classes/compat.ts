// Type definitions for bull 3.10
// Project: https://github.com/OptimalBits/bull
// Definitions by: Bruno Grieder <https://github.com/bgrieder>
//                 Cameron Crothers <https://github.com/JProgrammer>
//                 Marshall Cottrell <https://github.com/marshall007>
//                 Weeco <https://github.com/weeco>
//                 Gabriel Terwesten <https://github.com/blaugold>
//                 Oleg Repin <https://github.com/iamolegga>
//                 David Koblas <https://github.com/koblas>
//                 Bond Akinmade <https://github.com/bondz>
//                 Wuha Team <https://github.com/wuha-team>
//                 Alec Brunelle <https://github.com/aleccool213>
//                 Dan Manastireanu <https://github.com/danmana>
//                 Kjell-Morten Bratsberg Thorsen <https://github.com/kjellmorten>
//                 Christian D. <https://github.com/pc-jedi>
//                 Silas Rech <https://github.com/lenovouser>
//                 DoYoung Ha <https://github.com/hados99>
//                 Borys Kupar <https://github.com/borys-kupar>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped
// TypeScript Version: 2.8

import IORedis from "ioredis";
import { EventEmitter } from "events";
import {
  QueueEvents as V4QueueEvents,
  Worker as V4Worker,
  Queue as V4Queue,
  Job as V4Job,
} from '@src/classes';
import {
  ClientType as V4ClientType,
  JobsOpts as V4JobsOpts,
  QueueOptions as V4QueueOptions,
  QueueBaseOptions as V4QueueBaseOptions,
  AdvancedOpts as V4AdvancedOpts,
  BackoffOpts as V4BackoffOpts,
  RateLimiterOpts as V4RateLimiterOpts,
  RepeatOpts as V4RepeatOpts,
  QueueEventsOptions as V4QueueEventsOptions,
  WorkerOptions as V4WorkerOptions,
  Processor as V4Processor,
} from '@src/interfaces';
import _ from 'lodash';
import url from "url";

export default class Queue<T = any> extends EventEmitter {

  static readonly DEFAULT_JOB_NAME = "__default__";

  /**
   * The name of the queue
   */
  name: string;

  /**
   * Queue client (used to add jobs, pause queues, etc);
   */
  client: IORedis.Redis;

  private opts: QueueOptions;
  private keyPrefix: string;

  private queue: V4Queue;
  private queueEvents: V4QueueEvents;
  private worker: V4Worker;
  private handlers: { [key:string]: Function };

  /**
   * This is the Queue constructor.
   * It creates a new Queue that is persisted in Redis.
   * Everytime the same queue is instantiated it tries to process all the old jobs that may exist from a previous unfinished session.
   */
  constructor(queueName: string, opts?: QueueOptions);
  constructor(queueName: string, url: string, opts?: QueueOptions);

  constructor(queueName: string, arg2?: any, arg3?: any) {
    super();

    let opts: QueueOptions;

    if (_.isString(arg2)) {
      opts = _.extend(
        {},
        {
          redis: Utils.redisOptsFromUrl(arg2)
        },
        arg3
      );
    } else {
      opts = arg2;
    }

    this.opts = opts;
    this.name = queueName;

    this.keyPrefix = opts.redis.keyPrefix || opts.prefix || 'bull';

    //
    // We cannot use ioredis keyPrefix feature since we
    // create keys dynamically in lua scripts.
    //
    delete opts.redis.keyPrefix;
  }

  /**
   * Returns a promise that resolves when Redis is connected and the queue is ready to accept jobs.
   * This replaces the `ready` event emitted on Queue in previous verisons.
   */
  async isReady(): Promise<this> {
    await this.getQueue().waitUntilReady();
    return this;
  };

  /* tslint:disable:unified-signatures */

  /**
   * Defines a processing function for the jobs placed into a given Queue.
   *
   * The callback is called everytime a job is placed in the queue.
   * It is passed an instance of the job as first argument.
   *
   * If the callback signature contains the second optional done argument,
   * the callback will be passed a done callback to be called after the job has been completed.
   * The done callback can be called with an Error instance, to signal that the job did not complete successfully,
   * or with a result as second argument (e.g.: done(null, result);) when the job is successful.
   * Errors will be passed as a second argument to the "failed" event; results, as a second argument to the "completed" event.
   *
   * If, however, the callback signature does not contain the done argument,
   * a promise must be returned to signal job completion.
   * If the promise is rejected, the error will be passed as a second argument to the "failed" event.
   * If it is resolved, its value will be the "completed" event's second argument.
   */
  process(callback: ProcessCallbackFunction<T>): Promise<void>;
  process(callback: ProcessPromiseFunction<T>): Promise<void>;
  process(callback: string): Promise<void>;

  /**
   * Defines a processing function for the jobs placed into a given Queue.
   *
   * The callback is called everytime a job is placed in the queue.
   * It is passed an instance of the job as first argument.
   *
   * If the callback signature contains the second optional done argument,
   * the callback will be passed a done callback to be called after the job has been completed.
   * The done callback can be called with an Error instance, to signal that the job did not complete successfully,
   * or with a result as second argument (e.g.: done(null, result);) when the job is successful.
   * Errors will be passed as a second argument to the "failed" event; results, as a second argument to the "completed" event.
   *
   * If, however, the callback signature does not contain the done argument,
   * a promise must be returned to signal job completion.
   * If the promise is rejected, the error will be passed as a second argument to the "failed" event.
   * If it is resolved, its value will be the "completed" event's second argument.
   *
   * @param concurrency Bull will then call your handler in parallel respecting this maximum value.
   */
  process(concurrency: number, callback: ProcessCallbackFunction<T>): Promise<void>;
  process(concurrency: number, callback: ProcessPromiseFunction<T>): Promise<void>;
  process(concurrency: number, callback: string): Promise<void>;

  /**
   * Defines a processing function for the jobs placed into a given Queue.
   *
   * The callback is called everytime a job is placed in the queue.
   * It is passed an instance of the job as first argument.
   *
   * If the callback signature contains the second optional done argument,
   * the callback will be passed a done callback to be called after the job has been completed.
   * The done callback can be called with an Error instance, to signal that the job did not complete successfully,
   * or with a result as second argument (e.g.: done(null, result);) when the job is successful.
   * Errors will be passed as a second argument to the "failed" event; results, as a second argument to the "completed" event.
   *
   * If, however, the callback signature does not contain the done argument,
   * a promise must be returned to signal job completion.
   * If the promise is rejected, the error will be passed as a second argument to the "failed" event.
   * If it is resolved, its value will be the "completed" event's second argument.
   *
   * @param name Bull will only call the handler if the job name matches
   */
  process(name: string, callback: ProcessCallbackFunction<T>): Promise<void>;
  process(name: string, callback: ProcessPromiseFunction<T>): Promise<void>;
  process(name: string, callback: string): Promise<void>;

  /**
   * Defines a processing function for the jobs placed into a given Queue.
   *
   * The callback is called everytime a job is placed in the queue.
   * It is passed an instance of the job as first argument.
   *
   * If the callback signature contains the second optional done argument,
   * the callback will be passed a done callback to be called after the job has been completed.
   * The done callback can be called with an Error instance, to signal that the job did not complete successfully,
   * or with a result as second argument (e.g.: done(null, result);) when the job is successful.
   * Errors will be passed as a second argument to the "failed" event; results, as a second argument to the "completed" event.
   *
   * If, however, the callback signature does not contain the done argument,
   * a promise must be returned to signal job completion.
   * If the promise is rejected, the error will be passed as a second argument to the "failed" event.
   * If it is resolved, its value will be the "completed" event's second argument.
   *
   * @param name Bull will only call the handler if the job name matches
   * @param concurrency Bull will then call your handler in parallel respecting this maximum value.
   */
  process(name: string, concurrency: number, callback: ProcessCallbackFunction<T>): Promise<void>;
  process(name: string, concurrency: number, callback: ProcessPromiseFunction<T>): Promise<void>;
  process(name: string, concurrency: number, callback: string): Promise<void>;

  process(arg1: any, arg2?: any, arg3?: any): Promise<void> {
    let name: string = Queue.DEFAULT_JOB_NAME;
    let concurrency: number = 1;
    let handler: Function;
    let handlerFile: string;

    if(arguments.length === 1) {
      if(typeof arg1 === "function") {
        handler = arg1;
      } else if(typeof arg1 === "string") {
        handlerFile = arg1;
      }
    }
    else if(arguments.length === 2) {
      if(typeof arg1 === "number") {
        concurrency = arg1 > 0 ? arg1 : 1;
      } else if(typeof arg1 === "string") {
        name = arg1;
      }
      if(typeof arg2 === "function") {
        handler = arg2;
      } else if(typeof arg2 === "string") {
        handlerFile = arg2;
      }
    }
    else if(arguments.length === 3) {
      if(typeof arg1 === "string") {
        name = arg1;
      }
      if(typeof arg2 === "number") {
        concurrency = arg2 > 0 ? arg2 : 1;
      }
      if(typeof arg3 === "function") {
        handler = arg3;
      } else if(typeof arg3 === "string") {
        handlerFile = arg3;
      }
    }

    if (!handler && !handlerFile) {
      throw new Error('Cannot set an undefined handler');
    }
    if (this.handlers[name]) {
      throw new Error('Cannot define the same handler twice ' + name);
    }

    if(handlerFile && name !== Queue.DEFAULT_JOB_NAME) {
      throw new Error('Named processors are not supported with sandboxed workers');
    }

    this.handlers[name] = handler;

    if(! this.worker) {
      const workerOpts = Utils.convertToV4WorkerOptions(this.opts);
      workerOpts.concurrency = concurrency;
      if(handlerFile) {
        this.worker = new V4Worker(this.name, handlerFile, workerOpts);
      } else {
        this.worker = new V4Worker(this.name, this.createProcessor(), workerOpts);
      }
    }
    return this.worker.waitUntilReady();
  }

  /* tslint:enable:unified-signatures */

  /**
   * Creates a new job and adds it to the queue.
   * If the queue is empty the job will be executed directly,
   * otherwise it will be placed in the queue and executed as soon as possible.
   */
  add(data: T, opts?: JobOptions): Promise<Job<T>>;

  /**
   * Creates a new named job and adds it to the queue.
   * If the queue is empty the job will be executed directly,
   * otherwise it will be placed in the queue and executed as soon as possible.
   */
  add(name: string, data: T, opts?: JobOptions): Promise<Job<T>>;

  add(arg1: any, arg2?: any, arg3?: any): Promise<Job<T>> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that resolves when the queue is paused.
   *
   * A paused queue will not process new jobs until resumed, but current jobs being processed will continue until
   * they are finalized. The pause can be either global or local. If global, all workers in all queue instances
   * for a given queue will be paused. If local, just this worker will stop processing new jobs after the current
   * lock expires. This can be useful to stop a worker from taking new jobs prior to shutting down.
   *
   * Pausing a queue that is already paused does nothing.
   */
  async pause(isLocal?: boolean): Promise<void> {
    if(isLocal) {
      return this.worker && this.worker.pause(true);
    } else {
      return this.queue && this.queue.pause();
    }
  }

  /**
   * Returns a promise that resolves when the queue is resumed after being paused.
   *
   * The resume can be either local or global. If global, all workers in all queue instances for a given queue
   * will be resumed. If local, only this worker will be resumed. Note that resuming a queue globally will not
   * resume workers that have been paused locally; for those, resume(true) must be called directly on their
   * instances.
   *
   * Resuming a queue that is not paused does nothing.
   */
  async resume(isLocal?: boolean): Promise<void>{
    if(isLocal) {
      return this.worker && this.worker.resume();
    } else {
      return this.queue && this.queue.resume();
    }
  }


  /**
   * Returns a promise that returns the number of jobs in the queue, waiting or paused.
   * Since there may be other processes adding or processing jobs, this value may be true only for a very small amount of time.
   */
  count(): Promise<number>{
    return this.getQueue().count();
  }


  /**
   * Empties a queue deleting all the input lists and associated jobs.
   */
  empty(): Promise<void>{
    throw new Error('Not supported');
  }


  /**
   * Closes the underlying redis client. Use this to perform a graceful shutdown.
   *
   * `close` can be called from anywhere, with one caveat:
   * if called from within a job handler the queue won't close until after the job has been processed
   */
  close(): Promise<any>{
    const promises = [];

    if(this.queue) {
      promises.push(this.queue.close());
    }
    if(this.queueEvents) {
      promises.push(this.queueEvents.close());
    }
    if(this.worker) {
      promises.push(this.worker.close());
    }
    return Promise.all(promises);
  }


  /**
   * Returns a promise that will return the job instance associated with the jobId parameter.
   * If the specified job cannot be located, the promise callback parameter will be set to null.
   */
  async getJob(jobId: JobId): Promise<Job<T> | null>{
    const job = await this.getQueue().getJob(Utils.convertToV4JobId(jobId));
    return Utils.convertToJob(job, this);
  }


  /**
   * Returns a promise that will return an array with the waiting jobs between start and end.
   */
  getWaiting(start?: number, end?: number): Promise<Array<Job<T>>>{
    throw new Error('Not supported');
  }


  /**
   * Returns a promise that will return an array with the active jobs between start and end.
   */
  getActive(start?: number, end?: number): Promise<Array<Job<T>>>{
    throw new Error('Not supported');
  }


  /**
   * Returns a promise that will return an array with the delayed jobs between start and end.
   */
  getDelayed(start?: number, end?: number): Promise<Array<Job<T>>>{
    throw new Error('Not supported');
  }


  /**
   * Returns a promise that will return an array with the completed jobs between start and end.
   */
  getCompleted(start?: number, end?: number): Promise<Array<Job<T>>>{
    throw new Error('Not supported');
  }


  /**
   * Returns a promise that will return an array with the failed jobs between start and end.
   */
  getFailed(start?: number, end?: number): Promise<Array<Job<T>>>{
    throw new Error('Not supported');
  }


  /**
   * Returns JobInformation of repeatable jobs (ordered descending). Provide a start and/or an end
   * index to limit the number of results. Start defaults to 0, end to -1 and asc to false.
   */
  getRepeatableJobs(start?: number, end?: number, asc?: boolean): Promise<JobInformation[]>{
    throw new Error('Not supported');
  }


  /**
   * ???
   */
  nextRepeatableJob(name: string, data: any, opts: JobOptions): Promise<Job<T>>{
    throw new Error('Not supported');
  }


  /**
   * Removes a given repeatable job. The RepeatOptions and JobId needs to be the same as the ones
   * used for the job when it was added.
   */
  removeRepeatable(repeat: (CronRepeatOptions | EveryRepeatOptions) & { jobId?: JobId }): Promise<void>

  /**
   * Removes a given repeatable job. The RepeatOptions and JobId needs to be the same as the ones
   * used for the job when it was added.
   *
   * name: The name of the to be removed job
   */
  removeRepeatable(name: string, repeat: (CronRepeatOptions | EveryRepeatOptions) & { jobId?: JobId }): Promise<void>;

  removeRepeatable(arg1: any, arg2?: any): Promise<void> {
    throw new Error('Not supported');
  }

  /**
   * Removes a given repeatable job by key.
   */
  removeRepeatableByKey(key: string): Promise<void> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that will return an array of job instances of the given types.
   * Optional parameters for range and ordering are provided.
   */
  getJobs(types: string[], start?: number, end?: number, asc?: boolean): Promise<Array<Job<T>>> {
    throw new Error('Not supported');
  }

  /**
   * Returns a object with the logs according to the start and end arguments. The returned count
   * value is the total amount of logs, useful for implementing pagination.
   */
  getJobLogs(jobId: string, start?: number, end?: number): Promise<{ logs: string[], count: number }> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that resolves with the job counts for the given queue.
   */
  getJobCounts(): Promise<JobCounts> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that resolves with the job counts for the given queue of the given types.
   */
  getJobCountByTypes(types: string[] | string): Promise<JobCounts> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that resolves with the quantity of completed jobs.
   */
  getCompletedCount(): Promise<number> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that resolves with the quantity of failed jobs.
   */
  getFailedCount(): Promise<number> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that resolves with the quantity of delayed jobs.
   */
  getDelayedCount(): Promise<number> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that resolves with the quantity of waiting jobs.
   */
  getWaitingCount(): Promise<number> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that resolves with the quantity of paused jobs.
   */
  getPausedCount(): Promise<number> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that resolves with the quantity of active jobs.
   */
  getActiveCount(): Promise<number> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that resolves to the quantity of repeatable jobs.
   */
  getRepeatableCount(): Promise<number> {
    throw new Error('Not supported');
  }

  /**
   * Tells the queue remove all jobs created outside of a grace period in milliseconds.
   * You can clean the jobs with the following states: completed, wait (typo for waiting), active, delayed, and failed.
   * @param grace Grace period in milliseconds.
   * @param status Status of the job to clean. Values are completed, wait, active, delayed, and failed. Defaults to completed.
   * @param limit Maximum amount of jobs to clean per call. If not provided will clean all matching jobs.
   */
  clean(grace: number, status?: JobStatusClean, limit?: number): Promise<Array<Job<T>>> {
    throw new Error('Not supported');
  }

  /**
   * Listens to queue events
   */
  on(event: string, callback: (...args: any[]) => void): this;

  /**
   * An error occured
   */
  on(event: 'error', callback: ErrorEventCallback): this;

  /**
   * A Job is waiting to be processed as soon as a worker is idling.
   */
  on(event: 'waiting', callback: WaitingEventCallback): this;

  /**
   * A job has started. You can use `jobPromise.cancel()` to abort it
   */
  on(event: 'active', callback: ActiveEventCallback<T>): this;

  /**
   * A job has been marked as stalled.
   * This is useful for debugging job workers that crash or pause the event loop.
   */
  on(event: 'stalled', callback: StalledEventCallback<T>): this;

  /**
   * A job's progress was updated
   */
  on(event: 'progress', callback: ProgressEventCallback<T>): this;

  /**
   * A job successfully completed with a `result`
   */
  on(event: 'completed', callback: CompletedEventCallback<T>): this;

  /**
   * A job failed with `err` as the reason
   */
  on(event: 'failed', callback: FailedEventCallback<T>): this;

  /**
   * The queue has been paused
   */
  on(event: 'paused', callback: EventCallback): this;

  /**
   * The queue has been resumed
   */
  on(event: 'resumed', callback: EventCallback): this; // tslint:disable-line unified-signatures

  /**
   * A job successfully removed.
   */
  on(event: 'removed', callback: RemovedEventCallback<T>): this;

  /**
   * Old jobs have been cleaned from the queue.
   * `jobs` is an array of jobs that were removed, and `type` is the type of those jobs.
   *
   * @see Queue#clean() for details
   */
  on(event: 'cleaned', callback: CleanedEventCallback<T>): this;

  /**
   * Emitted every time the queue has processed all the waiting jobs
   * (even if there can be some delayed jobs not yet processed)
   */
  on(event: 'drained', callback: EventCallback): this; // tslint:disable-line unified-signatures

  on(event: string, callback: Function): this {
    throw new Error('Not supported');
  }

  /**
   * Array of Redis clients the queue uses
   */
  clients: IORedis.Redis[];

  /**
   * Set clientName to Redis.client
   */
  setWorkerName(): Promise<any> {
    throw new Error('Not supported');
  }

  /**
   * Returns Redis clients array which belongs to current Queue
   */
  getWorkers(): Promise<IORedis.Redis[]> {
    throw new Error('Not supported');
  }

  /**
   * Returns Queue name in base64 encoded format
   */
  base64Name(): string {
    throw new Error('Not supported');
  }

  /**
   * Returns Queue name with keyPrefix (default: 'bull')
   */
  clientName(): string {
    throw new Error('Not supported');
  }

  /**
   * Returns Redis clients array which belongs to current Queue from string with all redis clients
   *
   * @param list String with all redis clients
   */
  parseClientList(list: string): IORedis.Redis[] {
    throw new Error('Not supported');
  }

  private getQueue() {
    if (! this.queue) {
      this.queue = new V4Queue(this.name, Utils.convertToV4QueueOptions(this.opts));
    }
    return this.queue;
  }

  private createProcessor(): V4Processor {
    const handlers = this.handlers;

    return (job: V4Job): Promise<any> => {
      const name = job.name || Queue.DEFAULT_JOB_NAME;
      const handler = handlers[name] || handlers['*'];
      if(! handler) {
        throw new Error('Missing process handler for job type ' + name);
      }

      return new Promise((resolve, reject) => {
        if (handler.length > 1) {
          const done = (err: any, res: any) => {
            if(err) {
              reject(err);
            }
            resolve(res);
          };
          handler.apply(null, [job, done]); // TODO convert to Bull3 job
        } else {
          try {
            return resolve(handler.apply(null, [job])); // TODO convert to Bull3 job
          } catch (err) {
            return reject(err);
          }
        }
      });
    };
  }

}

export interface RateLimiter {
  /** Max numbers of jobs processed */
  max: number;
  /** Per duration in milliseconds */
  duration: number;
  /** When jobs get rate limited, they stay in the waiting queue and are not moved to the delayed queue */
  bounceBack?: boolean;
}

export interface QueueOptions {
  /**
   * Options passed directly to the `ioredis` constructor
   */
  redis?: IORedis.RedisOptions;

  /**
   * When specified, the `Queue` will use this function to create new `ioredis` client connections.
   * This is useful if you want to re-use connections or connect to a Redis cluster.
   */
  createClient?(type: 'client' | 'subscriber' | 'bclient', redisOpts?: IORedis.RedisOptions): IORedis.Redis | IORedis.Cluster;

  /**
   * Prefix to use for all redis keys
   */
  prefix?: string;

  settings?: AdvancedSettings;

  limiter?: RateLimiter;

  defaultJobOptions?: JobOptions;
}

export interface AdvancedSettings {
  /**
   * Key expiration time for job locks
   */
  lockDuration?: number;

  /**
   * Interval in milliseconds on which to acquire the job lock.
   */
  lockRenewTime?: number;

  /**
   * How often check for stalled jobs (use 0 for never checking)
   */
  stalledInterval?: number;

  /**
   * Max amount of times a stalled job will be re-processed
   */
  maxStalledCount?: number;

  /**
   * Poll interval for delayed jobs and added jobs
   */
  guardInterval?: number;

  /**
   * Delay before processing next job in case of internal error
   */
  retryProcessDelay?: number;

  /**
   * Define a custom backoff strategy
   */
  backoffStrategies?: {
    [key: string]: (attemptsMade: number, err: Error) => number;
  };

  /**
   * A timeout for when the queue is in `drained` state (empty waiting for jobs).
   * It is used when calling `queue.getNextJob()`, which will pass it to `.brpoplpush` on the Redis client.
   */
  drainDelay?: number;
}

export type DoneCallback = (error?: Error | null, value?: any) => void;

export type JobId = number | string;

export type ProcessCallbackFunction<T> = (job: Job<T>, done: DoneCallback) => void;
export type ProcessPromiseFunction<T> = (job: Job<T>) => Promise<void>;

export class Job<T = any> {

  constructor(queue: Queue, data: any, opts?: JobOptions);
  constructor(queue: Queue, name: string, data: any, opts?: JobOptions);

  constructor(queue: Queue, arg2: any, arg3?: any, arg4?: any) {
    throw new Error('Not supported');
  }

  id: JobId;

  /**
   * The custom data passed when the job was created
   */
  data: T;

  /**
   * Options of the job
   */
  opts: JobOptions;

  /**
   * How many attempts where made to run this job
   */
  attemptsMade: number;

  /**
   * When this job was started (unix milliseconds)
   */
  processedOn?: number;

  /**
   * When this job was completed (unix milliseconds)
   */
  finishedOn?: number;

  /**
   * Which queue this job was part of
   */
  queue: Queue<T>;

  timestamp: number;

  /**
   * The named processor name
   */
  name: string;

  /**
   * The stacktrace for any errors
   */
  stacktrace: string[];

  returnvalue: any;

  /**
   * Report progress on a job
   */
  progress(value: any): Promise<void> {
    throw new Error('Not supported');
  }

  /**
   * Logs one row of log data.
   *
   * @param row String with log data to be logged.
   */
  log(row: string): Promise<any> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise resolving to a boolean which, if true, current job's state is completed
   */
  isCompleted(): Promise<boolean> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise resolving to a boolean which, if true, current job's state is failed
   */
  isFailed(): Promise<boolean> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise resolving to a boolean which, if true, current job's state is delayed
   */
  isDelayed(): Promise<boolean> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise resolving to a boolean which, if true, current job's state is active
   */
  isActive(): Promise<boolean> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise resolving to a boolean which, if true, current job's state is wait
   */
  isWaiting(): Promise<boolean> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise resolving to a boolean which, if true, current job's state is paused
   */
  isPaused(): Promise<boolean> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise resolving to a boolean which, if true, current job's state is stuck
   */
  isStuck(): Promise<boolean> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise resolving to the current job's status.
   * Please take note that the implementation of this method is not very efficient, nor is
   * it atomic. If your queue does have a very large quantity of jobs, you may want to
   * avoid using this method.
   */
  getState(): Promise<JobStatus> {
    throw new Error('Not supported');
  }

  /**
   * Update a specific job's data. Promise resolves when the job has been updated.
   */
  update(data: any): Promise<void> {
    throw new Error('Not supported');
  }

  /**
   * Removes a job from the queue and from any lists it may be included in.
   * The returned promise resolves when the job has been removed.
   */
  remove(): Promise<void> {
    throw new Error('Not supported');
  }

  /**
   * Re-run a job that has failed. The returned promise resolves when the job
   * has been scheduled for retry.
   */
  retry(): Promise<void> {
    throw new Error('Not supported');
  }

  /**
   * Ensure this job is never ran again even if attemptsMade is less than job.attempts.
   */
  discard(): Promise<void> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that resolves to the returned data when the job has been finished.
   * TODO: Add a watchdog to check if the job has finished periodically.
   * since pubsub does not give any guarantees.
   */
  finished(): Promise<any> {
    throw new Error('Not supported');
  }

  /**
   * Moves a job to the `completed` queue. Pulls a job from 'waiting' to 'active'
   * and returns a tuple containing the next jobs data and id. If no job is in the `waiting` queue, returns null.
   */
  moveToCompleted(returnValue?: string, ignoreLock?: boolean): Promise<[any, JobId] | null> {
    throw new Error('Not supported');
  }

  /**
   * Moves a job to the `failed` queue. Pulls a job from 'waiting' to 'active'
   * and returns a tuple containing the next jobs data and id. If no job is in the `waiting` queue, returns null.
   */
  moveToFailed(errorInfo: { message: string; }, ignoreLock?: boolean): Promise<[any, JobId] | null> {
    throw new Error('Not supported');
  }

  /**
   * Promotes a job that is currently "delayed" to the "waiting" state and executed as soon as possible.
   */
  promote(): Promise<void> {
    throw new Error('Not supported');
  }

  /**
   * The lock id of the job
   */
  lockKey(): string {
    throw new Error('Not supported');
  }

  /**
   * Releases the lock on the job. Only locks owned by the queue instance can be released.
   */
  releaseLock(): Promise<void> {
    throw new Error('Not supported');
  }

  /**
   * Takes a lock for this job so that no other queue worker can process it at the same time.
   */
  takeLock(): Promise<number | false> {
    throw new Error('Not supported');
  }

  /**
   * Get job properties as Json Object
   */
  toJSON(): {
    id: JobId,
    name: string,
    data: T,
    opts: JobOptions,
    progress: number,
    delay: number,
    timestamp: number,
    attemptsMade: number,
    failedReason: any,
    stacktrace: string[] | null,
    returnvalue: any,
    finishedOn: number | null,
    processedOn: number | null
  } {
    throw new Error('Not supported');
  }
}

export type JobStatus = 'completed' | 'waiting' | 'active' | 'delayed' | 'failed';
export type JobStatusClean = 'completed' | 'wait' | 'active' | 'delayed' | 'failed';

export interface BackoffOptions {
  /**
   * Backoff type, which can be either `fixed` or `exponential`
   */
  type: string;

  /**
   * Backoff delay, in milliseconds
   */
  delay?: number;
}

export interface RepeatOptions {
  /**
   * Timezone
   */
  tz?: string;

  /**
   * End date when the repeat job should stop repeating
   */
  endDate?: Date | string | number;

  /**
   * Number of times the job should repeat at max.
   */
  limit?: number;
}

export interface CronRepeatOptions extends RepeatOptions {
  /**
   * Cron pattern specifying when the job should execute
   */
  cron: string;

  /**
   * Start date when the repeat job should start repeating (only with cron).
   */
  startDate?: Date | string | number;
}

export interface EveryRepeatOptions extends RepeatOptions {
  /**
   * Repeat every millis (cron setting cannot be used together with this setting.)
   */
  every: number;
}

export interface JobOptions {
  /**
   * Optional priority value. ranges from 1 (highest priority) to MAX_INT  (lowest priority).
   * Note that using priorities has a slight impact on performance, so do not use it if not required
   */
  priority?: number;

  /**
   * An amount of miliseconds to wait until this job can be processed.
   * Note that for accurate delays, both server and clients should have their clocks synchronized. [optional]
   */
  delay?: number;

  /**
   * The total number of attempts to try the job until it completes
   */
  attempts?: number;

  /**
   * Repeat job according to a cron specification
   */
  repeat?: CronRepeatOptions | EveryRepeatOptions;

  /**
   * Backoff setting for automatic retries if the job fails
   */
  backoff?: number | BackoffOptions;

  /**
   * A boolean which, if true, adds the job to the right
   * of the queue instead of the left (default false)
   */
  lifo?: boolean;

  /**
   *  The number of milliseconds after which the job should be fail with a timeout error
   */
  timeout?: number;

  /**
   * Override the job ID - by default, the job ID is a unique
   * integer, but you can use this setting to override it.
   * If you use this option, it is up to you to ensure the
   * jobId is unique. If you attempt to add a job with an id that
   * already exists, it will not be added.
   */
  jobId?: JobId;

  /**
   * A boolean which, if true, removes the job when it successfully completes.
   * When a number, it specifies the amount of jobs to keep.
   * Default behavior is to keep the job in the failed set.
   */
  removeOnComplete?: boolean | number;

  /**
   * A boolean which, if true, removes the job when it fails after all attempts.
   * When a number, it specifies the amount of jobs to keep.
   * Default behavior is to keep the job in the completed set.
   */
  removeOnFail?: boolean | number;

  /**
   * Limits the amount of stack trace lines that will be recorded in the stacktrace.
   */
  stackTraceLimit?: number;
}

export interface JobCounts {
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  waiting: number;
}

export interface JobInformation {
  key: string;
  name: string;
  id?: string;
  endDate?: number;
  tz?: string;
  cron: string;
  next: number;
}

export type EventCallback = () => void;

export type ErrorEventCallback = (error: Error) => void;

export interface JobPromise {
  /**
   * Abort this job
   */
  cancel(): void;
}

export type ActiveEventCallback<T = any> = (job: Job<T>, jobPromise?: JobPromise) => void;

export type StalledEventCallback<T = any> = (job: Job<T>) => void;

export type ProgressEventCallback<T = any> = (job: Job<T>, progress: any) => void;

export type CompletedEventCallback<T = any> = (job: Job<T>, result: any) => void;

export type FailedEventCallback<T = any> = (job: Job<T>, error: Error) => void;

export type CleanedEventCallback<T = any> = (jobs: Array<Job<T>>, status: JobStatusClean) => void;

export type RemovedEventCallback<T = any> = (job: Job<T>) => void;

export type WaitingEventCallback = (jobId: JobId) => void;

class Utils {

  static redisOptsFromUrl(urlString: string) {
    const redisOpts: IORedis.RedisOptions = {};
    try {
      const redisUrl = url.parse(urlString);
      redisOpts.port = parseInt(redisUrl.port, 10) || 6379;
      redisOpts.host = redisUrl.hostname;
      redisOpts.db = parseInt(redisUrl.pathname, 10) ?
        parseInt(redisUrl.pathname.split('/')[1], 10) : 0;
      if (redisUrl.auth) {
        redisOpts.password = redisUrl.auth.split(':')[1];
      }
    } catch (e) {
      throw new Error(e.message);
    }
    return redisOpts;
  };

  static convertToV4JobId(id: JobId): string {
    if(id) {
      if(typeof id === "string") {
        return id;
      } else {
        return id.toString();
      }
    }
  }

  static convertToJob(source: V4Job, queue: Queue<any>): Job {
    if(source) {
      return new Job(queue, source.name, source.data, Utils.convertToJobOptions(source.opts));
    }
  };

  static convertToJobOptions(source: V4JobsOpts): JobOptions {
    if(! source) {
      return;
    }

    const target: JobOptions = {};

    (target as any).timestamp = source.timestamp;
    target.priority = source.priority;
    target.delay = source.delay;
    target.attempts = source.attempts;
    target.repeat = Utils.convertToRepeatOptions(source.repeat);

    if(source.backoff !== undefined) {
      if(typeof source.backoff === "number") {
        target.backoff = source.backoff;
      } else {
        target.backoff = Utils.convertToBackoffOptions(source.backoff);
      }
    }

    target.lifo = source.lifo;
    target.timeout = source.timeout;
    target.jobId = source.jobId;
    target.removeOnComplete = source.removeOnComplete;
    target.removeOnFail = source.removeOnFail;
    target.stackTraceLimit = source.stackTraceLimit;
    return target;
  }

  static convertToV4QueueBaseOptions(source: QueueOptions): V4QueueBaseOptions {
    if(! source) {
      return;
    }

    const target: V4QueueBaseOptions = {};

    if (source.redis) {
      const client = new IORedis(source.redis);
      target.connection = client;
      target.client = client;
    }

    target.prefix = source.prefix;

    return target;
  }

  static convertToV4QueueOptions(source: QueueOptions): V4QueueOptions {
    if(! source) {
      return;
    }

    const target: V4QueueOptions = Utils.convertToV4QueueBaseOptions(source);

    target.defaultJobOptions = Utils.convertToV4JobsOpts(source.defaultJobOptions);
    target.createClient = Utils.adaptToV4CreateClient(source.createClient, source.redis);

    return target;
  }

  static convertToV4JobsOpts(source: JobOptions): V4JobsOpts {
    if(! source) {
      return;
    }

    const target: V4JobsOpts = {};

    target.timestamp = (source as any).timestamp;
    target.priority = source.priority;
    target.delay = source.delay;
    target.attempts = source.attempts;
    target.repeat = Utils.convertToV4RepeatOpts(source.repeat);

    if(source.backoff !== undefined) {
      if(typeof source.backoff === "number") {
        target.backoff = source.backoff;
      } else {
        target.backoff = Utils.convertToV4BackoffOpts(source.backoff);
      }
    }

    target.lifo = source.lifo;
    target.timeout = source.timeout;

    if(source.jobId !== undefined) {
      target.jobId = Utils.convertToV4JobId(source.jobId);
    }

    if(source.removeOnComplete !== undefined) {
      if(typeof source.removeOnComplete === "number") {
        console.log("Warning: numeric removeOnComplete option is not supported");
      } else {
        target.removeOnComplete = source.removeOnComplete;
      }
    }

    if(source.removeOnFail !== undefined) {
      if(typeof source.removeOnFail === "number") {
        console.log("Warning: numeric removeOnFail option is not supported");
      } else {
        target.removeOnFail = source.removeOnFail;
      }
    }
    target.stackTraceLimit = source.stackTraceLimit;
    return target;
  }

  static convertToV4RepeatOpts(source: CronRepeatOptions | EveryRepeatOptions): V4RepeatOpts {
    if(! source) {
      return;
    }

    const target: V4RepeatOpts = {};

    target.cron = (source as CronRepeatOptions).cron;
    target.tz = (source as CronRepeatOptions).tz;
    target.startDate = (source as CronRepeatOptions).startDate;
    target.endDate = (source as CronRepeatOptions).endDate;
    target.limit = (source as EveryRepeatOptions).limit;
    target.every = (source as EveryRepeatOptions).every;
    target.count = undefined;
    target.prevMillis = undefined;

    return target;
  }

  static convertToRepeatOptions(source: V4RepeatOpts): CronRepeatOptions | EveryRepeatOptions {
    if(! source) {
      return;
    }

    if(source.cron) {
      const target: CronRepeatOptions = { cron: undefined };
      target.cron = (source as CronRepeatOptions).cron;
      target.tz = (source as CronRepeatOptions).tz;
      target.startDate = (source as CronRepeatOptions).startDate;
      target.endDate = (source as CronRepeatOptions).endDate;
      target.limit = (source as EveryRepeatOptions).limit;
      return target;
    } else {
      const target: EveryRepeatOptions = { every: undefined };
      target.tz = (source as CronRepeatOptions).tz;
      target.endDate = (source as CronRepeatOptions).endDate;
      target.limit = (source as EveryRepeatOptions).limit;
      target.every = (source as EveryRepeatOptions).every;
      return target;
    }
  }

  static convertToV4BackoffOpts(source: BackoffOptions): V4BackoffOpts {
    if(! source) {
      return;
    }

    const target: V4BackoffOpts = { type: undefined, delay: undefined };

    target.type = source.type;
    target.delay = source.delay;

    return target;
  }

  static convertToBackoffOptions(source: V4BackoffOpts): BackoffOptions {
    if(! source) {
      return;
    }

    const target: BackoffOptions = { type: undefined };

    target.type = source.type;
    target.delay = source.delay;

    return target;
  }

  static convertToV4WorkerOptions(source: QueueOptions): V4WorkerOptions {
    if(! source) {
      return;
    }
    const target: V4WorkerOptions = Utils.convertToV4QueueBaseOptions(source);

    target.concurrency = undefined;
    target.limiter = Utils.convertToV4RateLimiterOpts(source.limiter);
    target.skipDelayCheck = undefined;
    target.drainDelay = undefined;
    target.visibilityWindow = undefined;
    target.settings = Utils.convertToV4AdvancedOpts(source.settings);

    return target;
  }

  static convertToV4RateLimiterOpts(source: RateLimiter): V4RateLimiterOpts {
    if(! source) {
      return;
    }

    const target: V4RateLimiterOpts = { max: undefined, duration: undefined };

    target.max = source.max;
    target.duration = source.duration;

    if(source.bounceBack !== undefined) {
      console.log("Warning: bounceBack option is not supported");
    }

    return target;
  }

  static convertToV4AdvancedOpts(source: AdvancedSettings): V4AdvancedOpts {
    if(! source) {
      return;
    }

    const target: V4AdvancedOpts = {};

    target.lockDuration = source.lockDuration;
    target.stalledInterval = source.stalledInterval;
    target.maxStalledCount = source.maxStalledCount;
    target.guardInterval = source.guardInterval;
    target.retryProcessDelay = source.retryProcessDelay;
    target.backoffStrategies = source.backoffStrategies;
    target.drainDelay = source.drainDelay;

    if(source.lockRenewTime !== undefined) {
      console.log("Warning: property lockRenewTime option is not supported");
    }

    return target;
  }

  static adaptToV4CreateClient(
    createClient: (type: 'client' | 'subscriber' | 'bclient', redisOpts?: IORedis.RedisOptions) => IORedis.Redis | IORedis.Cluster,
    redis: IORedis.RedisOptions): (type: V4ClientType) => IORedis.Redis {
    if(! createClient) {
      return;
    }

    return ((type) => {
      switch(type) {
        case V4ClientType.blocking:
          return createClient('bclient', redis) as IORedis.Redis;
        case V4ClientType.normal:
          return createClient('client', redis) as IORedis.Redis;
        default:
          return undefined;
      }
    });
  }

}
