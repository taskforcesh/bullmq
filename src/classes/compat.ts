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

import IORedis from 'ioredis';
import { EventEmitter } from 'events';
import { QueueEvents, Worker, Queue, QueueScheduler, Job } from '@src/classes';
import {
  ClientType,
  JobsOpts,
  QueueOptions,
  QueueBaseOptions,
  AdvancedOpts,
  BackoffOpts,
  RateLimiterOpts,
  RepeatOpts,
  QueueEventsOptions,
  QueueKeeperOptions,
  WorkerOptions,
  Processor,
} from '@src/interfaces';
import _ from 'lodash';
import url from 'url';

export class Queue3<T = any> extends EventEmitter {
  static readonly DEFAULT_JOB_NAME = '__default__';

  /**
   * The name of the queue
   */
  name: string;

  /**
   * Queue client (used to add jobs, pause queues, etc);
   */
  client: IORedis.Redis;

  eclient: IORedis.Redis;

  /**
   * Array of Redis clients the queue uses
   */
  clients: IORedis.Redis[];

  toKey: (type: string) => string;

  private opts: QueueOptions3;
  private settings: AdvancedSettings3;
  private defaultJobOptions: JobOptions3;
  private keyPrefix: string;

  private queue: Queue;
  private queuePromise: Promise<Queue>;
  private queuePromiseResolve: (value: Queue) => void;
  private queuePromiseReject: (reason: any) => void;
  private queueScheduler: QueueScheduler;
  private queueEvents: QueueEvents;
  private worker: Worker;
  private workerPromise: Promise<Worker>;
  private workerPromiseResolve: (value: Worker) => void;
  private workerPromiseReject: (reason: any) => void;
  private readonly handlers: { [key: string]: Function } = {};

  /**
   * This is the Queue constructor.
   * It creates a new Queue that is persisted in Redis.
   * Everytime the same queue is instantiated it tries to process all the old jobs
   * that may exist from a previous unfinished session.
   */
  constructor(queueName: string, opts?: QueueOptions3);
  constructor(queueName: string, url: string, opts?: QueueOptions3);

  constructor(queueName: string, arg2?: any, arg3?: any) {
    super();

    Object.defineProperties(this, {
      queue: {
        enumerable: false,
        writable: true,
      },
      queueScheduler: {
        enumerable: false,
        writable: true,
      },
      queueEvents: {
        enumerable: false,
        writable: true,
      },
      worker: {
        enumerable: false,
        writable: true,
      },
      workerPromise: {
        enumerable: false,
        writable: true,
      },
      workerPromiseResolve: {
        enumerable: false,
        writable: true,
      },
      workerPromiseReject: {
        enumerable: false,
        writable: true,
      },
      client: {
        get: () => {
          return (this.getQueue() as any).connection.client;
        },
      },
      eclient: {
        get: () => {
          return (this.getQueueEvents() as any).connection.client;
        },
      },
      clients: {
        get: () => {
          const clients = [this.getQueue().client];
          this.queueEvents && clients.push(this.queueEvents.client);
          this.worker && clients.push(this.worker.client);
          return clients;
        },
      },
      toKey: {
        get: () => {
          return this.getQueue().toKey;
        },
      },
    });

    let opts: QueueOptions3;

    if (_.isString(arg2)) {
      opts = _.extend(
        {},
        {
          redis: Utils.redisOptsFromUrl(arg2),
        },
        arg3,
      );
    } else {
      opts = arg2 || {};
    }

    opts.settings = opts.settings || {};
    _.defaults(opts.settings, {
      lockDuration: 30000,
      stalledInterval: 30000,
      maxStalledCount: 1,
      guardInterval: 5000,
      retryProcessDelay: 5000,
      drainDelay: 5,
      backoffStrategies: {},
    });
    opts.settings.lockRenewTime =
      opts.settings.lockRenewTime || opts.settings.lockDuration / 2;

    opts.redis = opts.redis || {};
    _.defaults(opts.redis, {
      port: 6379,
      host: '127.0.0.1',
      retryStrategy: (times: number) => {
        return Math.min(Math.exp(times), 20000);
      },
    });

    if (!opts.redis.db && opts.redis.db !== 0) {
      opts.redis.db = 0;
      if ((opts.redis as any).DB) {
        opts.redis.db = (opts.redis as any).DB;
      }
    }

    this.opts = opts;
    this.settings = opts.settings;

    if (opts.defaultJobOptions) {
      this.defaultJobOptions = opts.defaultJobOptions;
    }

    this.name = queueName || '';

    this.keyPrefix =
      (this.opts.redis && this.opts.redis.keyPrefix) ||
      this.opts.prefix ||
      'bull';

    //
    // We cannot use ioredis keyPrefix feature since we
    // create keys dynamically in lua scripts.
    //
    if (this.opts.redis && this.opts.redis.keyPrefix) {
      delete this.opts.redis.keyPrefix;
    }

    this.queuePromise = new Promise<Queue>((resolve, reject) => {
      this.queuePromiseResolve = resolve;
      this.queuePromiseReject = reject;
    }).catch(e => this.queue);

    this.workerPromise = new Promise<Worker>((resolve, reject) => {
      this.workerPromiseResolve = resolve;
      this.workerPromiseReject = reject;
    }).catch(e => this.worker);
  }

  /**
   * Returns a promise that resolves when Redis is connected and the queue is ready to accept jobs.
   * This replaces the `ready` event emitted on Queue in previous verisons.
   */
  async isReady(): Promise<this> {
    await this.getQueue().waitUntilReady();
    return this;
  }

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
   * Errors will be passed as a second argument to the "failed" event; results,
   * as a second argument to the "completed" event.
   *
   * If, however, the callback signature does not contain the done argument,
   * a promise must be returned to signal job completion.
   * If the promise is rejected, the error will be passed as a second argument to the "failed" event.
   * If it is resolved, its value will be the "completed" event's second argument.
   */
  process(callback: ProcessCallbackFunction3<T>): Promise<void>;
  process(callback: ProcessPromiseFunction3<T>): Promise<void>;
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
   * Errors will be passed as a second argument to the "failed" event; results,
   * as a second argument to the "completed" event.
   *
   * If, however, the callback signature does not contain the done argument,
   * a promise must be returned to signal job completion.
   * If the promise is rejected, the error will be passed as a second argument to the "failed" event.
   * If it is resolved, its value will be the "completed" event's second argument.
   *
   * @param concurrency Bull will then call your handler in parallel respecting this maximum value.
   */
  process(
    concurrency: number,
    callback: ProcessCallbackFunction3<T>,
  ): Promise<void>;
  process(
    concurrency: number,
    callback: ProcessPromiseFunction3<T>,
  ): Promise<void>;
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
   * Errors will be passed as a second argument to the "failed" event;
   * results, as a second argument to the "completed" event.
   *
   * If, however, the callback signature does not contain the done argument,
   * a promise must be returned to signal job completion.
   * If the promise is rejected, the error will be passed as a second argument to the "failed" event.
   * If it is resolved, its value will be the "completed" event's second argument.
   *
   * @param name Bull will only call the handler if the job name matches
   */
  process(name: string, callback: ProcessCallbackFunction3<T>): Promise<void>;
  process(name: string, callback: ProcessPromiseFunction3<T>): Promise<void>;
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
   * Errors will be passed as a second argument to the "failed" event;
   * results, as a second argument to the "completed" event.
   *
   * If, however, the callback signature does not contain the done argument,
   * a promise must be returned to signal job completion.
   * If the promise is rejected, the error will be passed as a second argument to the "failed" event.
   * If it is resolved, its value will be the "completed" event's second argument.
   *
   * @param name Bull will only call the handler if the job name matches
   * @param concurrency Bull will then call your handler in parallel respecting this maximum value.
   */
  process(
    name: string,
    concurrency: number,
    callback: ProcessCallbackFunction3<T>,
  ): Promise<void>;
  process(
    name: string,
    concurrency: number,
    callback: ProcessPromiseFunction3<T>,
  ): Promise<void>;
  process(name: string, concurrency: number, callback: string): Promise<void>;

  process(arg1: any, arg2?: any, arg3?: any): Promise<void> {
    let name: string = Queue3.DEFAULT_JOB_NAME;
    let concurrency = 1;
    let handler: Function;
    let handlerFile: string;

    if (arguments.length === 1) {
      if (typeof arg1 === 'function') {
        handler = arg1;
      } else if (typeof arg1 === 'string') {
        handlerFile = arg1;
      }
    } else if (arguments.length === 2) {
      if (typeof arg1 === 'number') {
        concurrency = arg1 > 0 ? arg1 : 1;
      } else if (typeof arg1 === 'string') {
        name = arg1;
      }
      if (typeof arg2 === 'function') {
        handler = arg2;
      } else if (typeof arg2 === 'string') {
        handlerFile = arg2;
      }
    } else if (arguments.length === 3) {
      if (typeof arg1 === 'string') {
        name = arg1;
      }
      if (typeof arg2 === 'number') {
        concurrency = arg2 > 0 ? arg2 : 1;
      }
      if (typeof arg3 === 'function') {
        handler = arg3;
      } else if (typeof arg3 === 'string') {
        handlerFile = arg3;
      }
    }

    if (!handler && !handlerFile) {
      throw new Error('Cannot set an undefined handler');
    }
    if (this.handlers[name]) {
      throw new Error('Cannot define the same handler twice ' + name);
    }

    if (handlerFile && name !== Queue3.DEFAULT_JOB_NAME) {
      throw new Error(
        'Named processors are not supported with sandboxed workers',
      );
    }

    this.handlers[name] = handler;

    if (!this.worker) {
      const workerOpts = Utils.convertToWorkerOptions(this.opts);
      workerOpts.concurrency = concurrency;
      if (handlerFile) {
        this.worker = new Worker(this.name, handlerFile, workerOpts);
      } else {
        this.worker = new Worker(
          this.name,
          Queue3.createProcessor(this),
          workerOpts,
        );
      }
      this.getQueueScheduler(); // create scheduler together with worker
      this.workerPromiseResolve(this.worker);
    }
    return this.worker.waitUntilReady();
  }

  /* tslint:enable:unified-signatures */

  /**
   * Creates a new job and adds it to the queue.
   * If the queue is empty the job will be executed directly,
   * otherwise it will be placed in the queue and executed as soon as possible.
   */
  add(data: T, opts?: JobOptions3): Promise<Job>;

  /**
   * Creates a new named job and adds it to the queue.
   * If the queue is empty the job will be executed directly,
   * otherwise it will be placed in the queue and executed as soon as possible.
   */
  add(name: string, data: T, opts?: JobOptions3): Promise<Job>;

  async add(arg1: any, arg2?: any, arg3?: any): Promise<Job> {
    let name: string = Queue3.DEFAULT_JOB_NAME;
    let data: any;
    let opts: JobOptions3 = {};

    if (typeof arg1 === 'string') {
      name = arg1 || Queue3.DEFAULT_JOB_NAME;
      data = arg2;
      opts = arg3 || {};
    } else {
      data = arg1;
      opts = arg2 || {};
    }

    opts = _.cloneDeep(opts || {});
    _.defaults(opts, this.defaultJobOptions);

    if (opts.repeat) {
      const result = await this.getQueue().repeat.addNextRepeatableJob(
        name,
        data,
        Utils.convertToJobsOpts(opts),
        true,
      );
      return result;
    } else {
      const result = await this.getQueue().append(
        name,
        data,
        Utils.convertToJobsOpts(opts),
      );
      return result;
    }
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
    if (isLocal) {
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
  async resume(isLocal?: boolean): Promise<void> {
    if (isLocal) {
      return this.worker && this.worker.resume();
    } else {
      return this.queue && this.queue.resume();
    }
  }

  /**
   * Returns a promise that returns the number of jobs in the queue, waiting or paused.
   * Since there may be other processes adding or processing jobs,
   * this value may be true only for a very small amount of time.
   */
  count(): Promise<number> {
    return this.getQueue().count();
  }

  /**
   * Empties a queue deleting all the input lists and associated jobs.
   */
  empty(): Promise<void> {
    return this.getQueue().drain(true);
  }

  /**
   * Closes the underlying redis client. Use this to perform a graceful shutdown.
   *
   * `close` can be called from anywhere, with one caveat:
   * if called from within a job handler the queue won't close until after the job has been processed
   */
  close(): Promise<any> {
    const promises = [];

    if (this.queueScheduler) {
      promises.push(this.queueScheduler.close());
    }
    if (this.queue) {
      promises.push(this.queue.close());
    }
    if (this.queueEvents) {
      promises.push(this.queueEvents.close());
    }
    if (this.worker) {
      promises.push(this.worker.close());
    }
    return Promise.all(promises);
  }

  /**
   * Returns a promise that will return the job instance associated with the jobId parameter.
   * If the specified job cannot be located, the promise callback parameter will be set to null.
   */
  getJob(jobId: string): Promise<Job | null> {
    return this.getQueue().getJob(jobId);
  }

  /**
   * Returns a promise that will return an array with the waiting jobs between start and end.
   */
  getWaiting(start = 0, end = -1): Promise<Array<Job>> {
    return this.getQueue().getWaiting(start, end);
  }

  /**
   * Returns a promise that will return an array with the active jobs between start and end.
   */
  getActive(start = 0, end = -1): Promise<Array<Job>> {
    return this.getQueue().getActive(start, end);
  }

  /**
   * Returns a promise that will return an array with the delayed jobs between start and end.
   */
  getDelayed(start = 0, end = -1): Promise<Array<Job>> {
    return this.getQueue().getDelayed(start, end);
  }

  /**
   * Returns a promise that will return an array with the completed jobs between start and end.
   */
  getCompleted(start = 0, end = -1): Promise<Array<Job>> {
    return this.getQueue().getCompleted(start, end);
  }

  /**
   * Returns a promise that will return an array with the failed jobs between start and end.
   */
  async getFailed(start = 0, end = -1): Promise<Array<Job>> {
    return this.getQueue().getFailed(start, end);
  }

  /**
   * Returns JobInformation of repeatable jobs (ordered descending). Provide a start and/or an end
   * index to limit the number of results. Start defaults to 0, end to -1 and asc to false.
   */
  getRepeatableJobs(
    start = 0,
    end = -1,
    asc = false,
  ): Promise<JobInformation3[]> {
    return this.getQueue().repeat.getRepeatableJobs(start, end, asc);
  }

  /**
   * ???
   */
  async nextRepeatableJob(
    name: string,
    data: any,
    opts: JobOptions3,
    skipCheckExists?: boolean,
  ): Promise<Job> {
    return this.getQueue().repeat.addNextRepeatableJob(
      name || Queue3.DEFAULT_JOB_NAME,
      data,
      Utils.convertToJobsOpts(opts),
      skipCheckExists,
    );
  }

  /**
   * Removes a given repeatable job. The RepeatOptions and JobId needs to be the same as the ones
   * used for the job when it was added.
   */
  removeRepeatable(
    repeat: (CronRepeatOptions3 | EveryRepeatOptions3) & { jobId?: string },
  ): Promise<void>;

  /**
   * Removes a given repeatable job. The RepeatOptions and JobId needs to be the same as the ones
   * used for the job when it was added.
   *
   * name: The name of the to be removed job
   */
  removeRepeatable(
    name: string,
    repeat: (CronRepeatOptions3 | EveryRepeatOptions3) & { jobId?: string },
  ): Promise<void>;

  async removeRepeatable(arg1: any, arg2?: any): Promise<void> {
    let name: string = Queue3.DEFAULT_JOB_NAME;
    let repeat: (CronRepeatOptions3 | EveryRepeatOptions3) & { jobId?: string };

    if (typeof arg1 === 'string') {
      name = arg1;
      repeat = arg2;
    } else {
      repeat = arg1;
    }
    return this.getQueue().repeat.removeRepeatable(
      name,
      Utils.convertToRepeatOpts(repeat),
      repeat.jobId,
    );
  }

  /**
   * Removes a given repeatable job by key.
   */
  async removeRepeatableByKey(repeatJobKey: string): Promise<void> {
    const repeat = this.getQueue().repeat;
    await repeat.waitUntilReady();

    const tokens = repeatJobKey.split(':');
    const data = {
      key: repeatJobKey,
      name: tokens[0],
      id: tokens[1] || null,
      endDate: parseInt(tokens[2]) || null,
      tz: tokens[3] || null,
      cron: tokens[4],
    };

    const queueKey = repeat.toKey('');
    return (<any>repeat.client).removeRepeatable(
      repeat.keys.repeat,
      repeat.keys.delayed,
      data.id,
      repeatJobKey,
      queueKey,
    );
  }

  /**
   * Returns a promise that will return an array of job instances of the given types.
   * Optional parameters for range and ordering are provided.
   */
  getJobs(
    types: string[],
    start = 0,
    end = -1,
    asc = false,
  ): Promise<Array<Job>> {
    return this.getQueue().getJobs(types, start, end, asc);
  }

  async getNextJob(): Promise<Job> {
    await this.getWorker().waitUntilReady();
    return this.worker.getNextJob();
  }

  /**
   * Returns a object with the logs according to the start and end arguments. The returned count
   * value is the total amount of logs, useful for implementing pagination.
   */
  getJobLogs(
    jobId: string,
    start = 0,
    end = -1,
  ): Promise<{ logs: string[]; count: number }> {
    return this.getQueue().getJobLogs(jobId, start, end);
  }

  /**
   * Returns a promise that resolves with the job counts for the given queue.
   */
  getJobCounts(
    types?: string[] | string,
  ): Promise<{ [index: string]: number }> {
    return this.getQueue().getJobCounts(...Utils.parseTypeArg(types));
  }

  /**
   * Returns a promise that resolves with the job counts for the given queue of the given types.
   */
  async getJobCountByTypes(types?: string[] | string): Promise<number> {
    return this.getQueue().getJobCountByTypes(...Utils.parseTypeArg(types));
  }

  /**
   * Returns a promise that resolves with the quantity of completed jobs.
   */
  getCompletedCount(): Promise<number> {
    return this.getQueue().getCompletedCount();
  }

  /**
   * Returns a promise that resolves with the quantity of failed jobs.
   */
  getFailedCount(): Promise<number> {
    return this.getQueue().getFailedCount();
  }

  /**
   * Returns a promise that resolves with the quantity of delayed jobs.
   */
  getDelayedCount(): Promise<number> {
    return this.getQueue().getDelayedCount();
  }

  /**
   * Returns a promise that resolves with the quantity of waiting jobs.
   */
  getWaitingCount(): Promise<number> {
    return this.getQueue().getWaitingCount();
  }

  /**
   * Returns a promise that resolves with the quantity of paused jobs.
   */
  getPausedCount(): Promise<number> {
    return this.getQueue().getJobCountByTypes('paused');
  }

  /**
   * Returns a promise that resolves with the quantity of active jobs.
   */
  getActiveCount(): Promise<number> {
    return this.getQueue().getActiveCount();
  }

  /**
   * Returns a promise that resolves to the quantity of repeatable jobs.
   */
  getRepeatableCount(): Promise<number> {
    return this.getQueue().repeat.getRepeatableCount();
  }

  /**
   * Tells the queue remove all jobs created outside of a grace period in milliseconds.
   * You can clean the jobs with the following states: completed, wait (typo for waiting), active, delayed, and failed.
   * @param grace Grace period in milliseconds.
   * @param status Status of the job to clean. Values are completed, wait,
   * active, delayed, and failed. Defaults to completed.
   * @param limit Maximum amount of jobs to clean per call. If not provided will clean all matching jobs.
   */
  clean(
    grace: number,
    status: JobStatusClean3 = 'completed',
    limit = -1,
  ): Promise<Array<Job>> {
    return this.getQueue().clean(grace, status, limit);
  }

  /**
   * Listens to queue events
   */
  on(event: string, callback: (...args: any[]) => void): this;

  /**
   * An error occured
   */
  on(event: 'error', callback: ErrorEventCallback3): this;

  /**
   * A Job is waiting to be processed as soon as a worker is idling.
   */
  on(event: 'waiting', callback: WaitingEventCallback3): this;

  /**
   * A job has started. You can use `jobPromise.cancel()` to abort it
   */
  on(event: 'active', callback: ActiveEventCallback3<T>): this;

  /**
   * A job has been marked as stalled.
   * This is useful for debugging job workers that crash or pause the event loop.
   */
  on(event: 'stalled', callback: StalledEventCallback3<T>): this;

  /**
   * A job's progress was updated
   */
  on(event: 'progress', callback: ProgressEventCallback3<T>): this;

  /**
   * A job successfully completed with a `result`
   */
  on(event: 'completed', callback: CompletedEventCallback3<T>): this;

  /**
   * A job failed with `err` as the reason
   */
  on(event: 'failed', callback: FailedEventCallback3<T>): this;

  /**
   * The queue has been paused
   */
  on(event: 'paused', callback: EventCallback3): this;

  /**
   * The queue has been resumed
   */
  on(event: 'resumed', callback: EventCallback3): this; // tslint:disable-line unified-signatures

  /**
   * A job successfully removed.
   */
  on(event: 'removed', callback: RemovedEventCallback3<T>): this;

  /**
   * Old jobs have been cleaned from the queue.
   * `jobs` is an array of jobs that were removed, and `type` is the type of those jobs.
   *
   * @see Queue#clean() for details
   */
  on(event: 'cleaned', callback: CleanedEventCallback3<T>): this;

  /**
   * Emitted every time the queue has processed all the waiting jobs
   * (even if there can be some delayed jobs not yet processed)
   */
  on(event: 'drained', callback: EventCallback3): this; // tslint:disable-line unified-signatures

  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return this.registerEventHandler(false, event, listener);
  }

  once(event: string | symbol, listener: (...args: any[]) => void): this {
    return this.registerEventHandler(true, event, listener);
  }

  off(event: string | symbol, listener: (...args: any[]) => void): this {
    return this.removeListener(event, listener);
  }

  removeListener(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this {
    const global = this.queueEvents;

    switch (event) {
      case 'active':
        this.onWorkerInit(worker => {
          worker.removeListener('active', listener);
        });
        break;
      case 'completed':
        this.onWorkerInit(worker => {
          worker.removeListener('completed', listener);
        });
        break;
      case 'drained':
        this.onWorkerInit(worker => {
          worker.removeListener('drained', listener);
        });
        break;
      case 'failed':
        this.onWorkerInit(worker => {
          worker.removeListener('failed', listener);
        });
        break;
      case 'paused':
        this.onWorkerInit(worker => {
          worker.removeListener('paused', listener);
        });
        this.onQueueInit(queue => {
          queue.removeListener('paused', listener);
        });
        break;
      case 'resumed':
        this.onWorkerInit(worker => {
          worker.removeListener('resumed', listener);
        });
        this.onQueueInit(queue => {
          queue.removeListener('resumed', listener);
        });
        break;
      case 'progress':
        this.onWorkerInit(worker => {
          worker.removeListener('progress', listener);
        });
        this.onQueueInit(queue => {
          queue.removeListener('progress', listener);
        });
        break;
      case 'global:active':
        global && global.removeListener('active', listener);
        break;
      case 'global:completed':
        global && global.removeListener('completed', listener);
        break;
      case 'global:drained':
        global && global.removeListener('drained', listener);
        break;
      case 'global:failed':
        global && global.removeListener('failed', listener);
        break;
      case 'global:paused':
        global && global.removeListener('paused', listener);
        break;
      case 'global:resumed':
        global && global.removeListener('resumed', listener);
        break;
      case 'global:waiting':
        global && global.removeListener('waiting', listener);
        break;
    }

    return this;
  }

  /**
   * Set clientName to Redis.client
   */
  setWorkerName(): Promise<any> {
    throw new Error('Not supported');
  }

  /**
   * Returns Redis clients array which belongs to current Queue
   */
  getWorkers(): Promise<{ [key: string]: string }[]> {
    return this.getQueue().getWorkers();
  }

  /**
   * Returns Queue name in base64 encoded format
   */
  base64Name(): string {
    return (this.getQueue() as any).base64Name();
  }

  /**
   * Returns Queue name with keyPrefix (default: 'bull')
   */
  clientName(): string {
    return (this.getQueue() as any).clientName();
  }

  /**
   * Returns Redis clients array which belongs to current Queue from string with all redis clients
   *
   * @param list String with all redis clients
   */
  parseClientList(list: string): { [key: string]: string }[] {
    return (this.getQueue() as any).parseClientList(list);
  }

  retryJob(job: Job): Promise<void> {
    return job.retry();
  }

  private getQueueScheduler() {
    if (!this.queueScheduler) {
      this.queueScheduler = new QueueScheduler(
        this.name,
        Utils.convertToQueueKeeperOptions(this.opts),
      );
    }
    return this.queueScheduler;
  }

  private getQueue() {
    if (!this.queue) {
      this.queue = new Queue(this.name, Utils.convertToQueueOptions(this.opts));
      this.queuePromiseResolve(this.queue);
    }
    return this.queue;
  }

  private getWorker() {
    if (!this.worker) {
      this.worker = new Worker(
        this.name,
        Queue3.createProcessor(this),
        Utils.convertToWorkerOptions(this.opts),
      );
      this.workerPromiseResolve(this.worker);
      this.getQueueScheduler(); // create scheduler together with worker
    }
    return this.worker;
  }

  private getQueueEvents() {
    if (!this.queueEvents) {
      this.queueEvents = new QueueEvents(
        this.name,
        Utils.convertToQueueEventsOptions(this.opts),
      );
    }
    return this.queueEvents;
  }

  private onQueueInit(cb: (queue: Queue) => void) {
    this.queuePromise = this.queuePromise
      .then(_ => {
        cb(this.queue);
        return this.queue;
      })
      .catch(_ => {
        return this.queue;
      });
  }

  private onWorkerInit(cb: (worker: Worker) => void) {
    this.workerPromise = this.workerPromise
      .then(_ => {
        cb(this.worker);
        return this.worker;
      })
      .catch(_ => {
        return this.worker;
      });
  }

  private registerEventHandler(
    once: boolean,
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this {
    switch (event) {
      case 'active':
        console.warn(`jobPromise won't be available on 'active' event handler`);
        if (once) {
          this.onWorkerInit(worker => {
            worker.once('active', (job, jobPromise, prev) => {
              listener(job, jobPromise, prev);
            });
          });
        } else {
          this.onWorkerInit(worker => {
            worker.on('active', (job, jobPromise, prev) => {
              listener(job, jobPromise, prev);
            });
          });
        }
        break;
      case 'cleaned':
        console.warn(`listening on 'cleaned' event is not supported`);
        break;
      case 'completed':
        if (once) {
          this.onWorkerInit(worker => {
            worker.once('completed', (job, returnvalue, prev) => {
              listener(job, returnvalue, prev);
            });
          });
        } else {
          this.onWorkerInit(worker => {
            worker.on('completed', (job, returnvalue, prev) => {
              listener(job, returnvalue, prev);
            });
          });
        }
        break;
      case 'drained':
        if (once) {
          this.onWorkerInit(worker => {
            worker.once('drained', () => {
              listener();
            });
          });
        } else {
          this.onWorkerInit(worker => {
            worker.on('drained', () => {
              listener();
            });
          });
        }
        break;
      case 'error':
        console.warn(`listening on 'error' event is not supported`);
        break;
      case 'failed':
        if (once) {
          this.onWorkerInit(worker => {
            worker.once('failed', (job, failedReason, prev) => {
              listener(job, failedReason, prev);
            });
          });
        } else {
          this.onWorkerInit(worker => {
            worker.on('failed', (job, failedReason, prev) => {
              listener(job, failedReason, prev);
            });
          });
        }
        break;
      case 'paused':
        if (once) {
          this.onWorkerInit(worker => {
            worker.once('paused', () => {
              listener();
            });
          });
          this.getQueue().once('paused', () => {
            listener();
          });
        } else {
          this.onWorkerInit(worker => {
            worker.on('paused', () => {
              listener();
            });
          });
          this.getQueue().on('paused', () => {
            listener();
          });
        }
        break;
      case 'resumed':
        if (once) {
          this.onWorkerInit(worker => {
            worker.once('resumed', () => {
              listener();
            });
          });
          this.getQueue().once('resumed', () => {
            listener();
          });
        } else {
          this.onWorkerInit(worker => {
            worker.on('resumed', () => {
              listener();
            });
          });
          this.getQueue().on('resumed', () => {
            listener();
          });
        }
        break;
      case 'progress':
        if (once) {
          this.getQueue().once('progress', (job, progress) => {
            listener(job, progress);
          });
        } else {
          this.getQueue().on('progress', (job, progress) => {
            listener(job, progress);
          });
        }
        break;
      case 'stalled':
        console.warn(`listening on 'stalled' event is not supported`);
        break;
      case 'waiting':
        if (once) {
          this.getQueue().once('waiting', job => {
            listener(job.id, null);
          });
        } else {
          this.getQueue().on('waiting', job => {
            listener(job.id, null);
          });
        }
        break;
      case 'global:active':
        if (once) {
          this.getQueueEvents().once('active', ({ jobId, prev }) => {
            listener(jobId, prev);
          });
        } else {
          this.getQueueEvents().on('active', ({ jobId, prev }) => {
            listener(jobId, prev);
          });
        }
        break;
      case 'global:completed':
        if (once) {
          this.getQueueEvents().once(
            'completed',
            ({ jobId, returnvalue, prev }) => {
              listener(jobId, returnvalue, prev || 'active');
            },
          );
        } else {
          this.getQueueEvents().on(
            'completed',
            ({ jobId, returnvalue, prev }) => {
              listener(jobId, returnvalue, prev || 'active');
            },
          );
        }
        break;
      case 'global:drained':
        if (once) {
          this.getQueueEvents().once('drained', () => {
            listener();
          });
        } else {
          this.getQueueEvents().on('drained', () => {
            listener();
          });
        }
        break;
      case 'global:failed':
        if (once) {
          this.getQueueEvents().once(
            'failed',
            ({ jobId, failedReason, prev }) => {
              listener(jobId, failedReason, prev || 'active');
            },
          );
        } else {
          this.getQueueEvents().on(
            'failed',
            ({ jobId, failedReason, prev }) => {
              listener(jobId, failedReason, prev || 'active');
            },
          );
        }
        break;
      case 'global:paused':
        if (once) {
          this.getQueueEvents().once('paused', () => {
            listener();
          });
        } else {
          this.getQueueEvents().on('paused', () => {
            listener();
          });
        }
        break;
      case 'global:progress':
        console.warn(`listening on 'global:progress' event is not supported`);
        break;
      case 'global:resumed':
        if (once) {
          this.getQueueEvents().once('resumed', () => {
            listener();
          });
        } else {
          this.getQueueEvents().on('resumed', () => {
            listener();
          });
        }
        break;
      case 'global:stalled':
        console.warn(`listening on 'global:stalled' event is not supported`);
        break;
      case 'global:waiting':
        if (once) {
          this.getQueueEvents().once('waiting', ({ jobId }) => {
            listener(jobId, null);
          });
        } else {
          this.getQueueEvents().on('waiting', ({ jobId }) => {
            listener(jobId, null);
          });
        }
        break;
      default:
        console.warn(`Listening on '${String(event)}' event is not supported`);
    }
    return this;
  }

  private static createProcessor(queue: Queue3): Processor {
    return (job: Job): Promise<any> => {
      const name = job.name || Queue3.DEFAULT_JOB_NAME;
      const handler = queue.handlers[name] || queue.handlers['*'];
      if (!handler) {
        throw new Error('Missing process handler for job type ' + name);
      }

      return new Promise((resolve, reject) => {
        if (handler.length > 1) {
          const done = (err: any, res: any) => {
            if (err) {
              reject(err);
            }
            resolve(res);
          };
          handler.apply(null, [job, done]);
        } else {
          try {
            return resolve(handler.apply(null, [job]));
          } catch (err) {
            return reject(err);
          }
        }
      });
    };
  }
}

export interface RateLimiter3 {
  /** Max numbers of jobs processed */
  max: number;
  /** Per duration in milliseconds */
  duration: number;
  /** When jobs get rate limited, they stay in the waiting queue and are not moved to the delayed queue */
  bounceBack?: boolean;
}

export interface QueueOptions3 {
  /**
   * Options passed directly to the `ioredis` constructor
   */
  redis?: IORedis.RedisOptions;

  /**
   * When specified, the `Queue` will use this function to create new `ioredis` client connections.
   * This is useful if you want to re-use connections or connect to a Redis cluster.
   */
  createClient?(
    type: 'client' | 'subscriber' | 'bclient',
    redisOpts?: IORedis.RedisOptions,
  ): IORedis.Redis | IORedis.Cluster;

  /**
   * Prefix to use for all redis keys
   */
  prefix?: string;

  settings?: AdvancedSettings3;

  limiter?: RateLimiter3;

  defaultJobOptions?: JobOptions3;
}

export interface AdvancedSettings3 {
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

export type DoneCallback3 = (error?: Error | null, value?: any) => void;

export type ProcessCallbackFunction3<T> = (
  job: Job,
  done: DoneCallback3,
) => void;
export type ProcessPromiseFunction3<T> = (job: Job) => Promise<void>;

export type JobStatus3 =
  | 'completed'
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'failed';
export type JobStatusClean3 =
  | 'completed'
  | 'wait'
  | 'active'
  | 'delayed'
  | 'paused'
  | 'failed';

export interface BackoffOptions3 {
  /**
   * Backoff type, which can be either `fixed` or `exponential`
   */
  type: string;

  /**
   * Backoff delay, in milliseconds
   */
  delay?: number;
}

export interface RepeatOptions3 {
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

export interface CronRepeatOptions3 extends RepeatOptions3 {
  /**
   * Cron pattern specifying when the job should execute
   */
  cron: string;

  /**
   * Start date when the repeat job should start repeating (only with cron).
   */
  startDate?: Date | string | number;
}

export interface EveryRepeatOptions3 extends RepeatOptions3 {
  /**
   * Repeat every millis (cron setting cannot be used together with this setting.)
   */
  every: number;
}

export interface JobOptions3 {
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
  repeat?: CronRepeatOptions3 | EveryRepeatOptions3;

  /**
   * Backoff setting for automatic retries if the job fails
   */
  backoff?: number | BackoffOptions3;

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
  jobId?: string;

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

export interface JobCounts3 {
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  waiting: number;
}

export interface JobInformation3 {
  key: string;
  name: string;
  id?: string;
  endDate?: number;
  tz?: string;
  cron: string;
  next: number;
}

export type EventCallback3 = () => void;

export type ErrorEventCallback3 = (error: Error) => void;

export interface JobPromise3 {
  /**
   * Abort this job
   */
  cancel(): void;
}

export type ActiveEventCallback3<T = any> = (
  job: Job,
  jobPromise?: JobPromise3,
) => void;

export type StalledEventCallback3<T = any> = (job: Job) => void;

export type ProgressEventCallback3<T = any> = (job: Job, progress: any) => void;

export type CompletedEventCallback3<T = any> = (job: Job, result: any) => void;

export type FailedEventCallback3<T = any> = (job: Job, error: Error) => void;

export type CleanedEventCallback3<T = any> = (
  jobs: Array<Job>,
  status: JobStatusClean3,
) => void;

export type RemovedEventCallback3<T = any> = (job: Job) => void;

export type WaitingEventCallback3 = (jobId: string) => void;

class Utils {
  static redisOptsFromUrl(urlString: string) {
    const redisOpts: IORedis.RedisOptions = {};
    try {
      const redisUrl = url.parse(urlString);
      redisOpts.port = parseInt(redisUrl.port) || 6379;
      redisOpts.host = redisUrl.hostname;
      redisOpts.db = redisUrl.pathname
        ? parseInt(redisUrl.pathname.split('/')[1])
        : 0;
      if (redisUrl.auth) {
        redisOpts.password = redisUrl.auth.split(':')[1];
      }
    } catch (e) {
      throw new Error(e.message);
    }
    return redisOpts;
  }

  static convertToQueueBaseOptions(source: QueueOptions3): QueueBaseOptions {
    if (!source) {
      return;
    }

    const target: QueueBaseOptions = {};

    if (source.redis) {
      const client = new IORedis(source.redis);
      target.connection = client;
      target.client = client;
    }

    target.prefix = source.prefix;

    return target;
  }

  static convertToQueueOptions(source: QueueOptions3): QueueOptions {
    if (!source) {
      return;
    }

    const target: QueueOptions = Utils.convertToQueueBaseOptions(source);

    target.defaultJobOptions = Utils.convertToJobsOpts(
      source.defaultJobOptions,
    );
    target.createClient = Utils.adaptToCreateClient(
      source.createClient,
      source.redis,
    );

    return target;
  }

  static convertToQueueEventsOptions(
    source: QueueOptions3,
  ): QueueEventsOptions {
    if (!source) {
      return;
    }

    const target: QueueEventsOptions = Utils.convertToQueueBaseOptions(source);

    target.lastEventId = undefined;
    target.blockingTimeout = undefined;

    return target;
  }

  static convertToQueueKeeperOptions(
    source: QueueOptions3,
  ): QueueKeeperOptions {
    if (!source) {
      return;
    }

    const target: QueueKeeperOptions = Utils.convertToQueueBaseOptions(source);

    if (source.settings) {
      target.maxStalledCount = source.settings.maxStalledCount;
      target.stalledInterval = source.settings.stalledInterval;
    }

    return target;
  }

  static convertToJobsOpts(source: JobOptions3): JobsOpts {
    if (!source) {
      return;
    }

    const target: JobsOpts = {};

    target.timestamp = (source as any).timestamp;
    target.priority = source.priority;
    target.delay = source.delay;
    target.attempts = source.attempts;
    target.repeat = Utils.convertToRepeatOpts(source.repeat);

    if (source.backoff !== undefined) {
      if (typeof source.backoff === 'number') {
        target.backoff = source.backoff;
      } else {
        target.backoff = Utils.convertToBackoffOpts(source.backoff);
      }
    }

    target.lifo = source.lifo;
    target.timeout = source.timeout;

    if (source.jobId !== undefined) {
      target.jobId = source.jobId;
    }

    target.removeOnComplete = source.removeOnComplete;
    target.removeOnFail = source.removeOnFail;
    target.stackTraceLimit = source.stackTraceLimit;
    return target;
  }

  static convertToRepeatOpts(
    source: CronRepeatOptions3 | EveryRepeatOptions3,
  ): RepeatOpts {
    if (!source) {
      return;
    }

    const target: RepeatOpts = {};

    target.cron = (source as CronRepeatOptions3).cron;
    target.tz = (source as CronRepeatOptions3).tz;
    target.startDate = (source as CronRepeatOptions3).startDate;
    target.endDate = (source as CronRepeatOptions3).endDate;
    target.limit = (source as EveryRepeatOptions3).limit;
    target.every = (source as EveryRepeatOptions3).every;
    target.count = undefined;
    target.prevMillis = undefined;

    return target;
  }

  static convertToBackoffOpts(source: BackoffOptions3): BackoffOpts {
    if (!source) {
      return;
    }

    const target: BackoffOpts = { type: undefined, delay: undefined };

    target.type = source.type;
    target.delay = source.delay;

    return target;
  }

  static convertToWorkerOptions(source: QueueOptions3): WorkerOptions {
    if (!source) {
      return;
    }
    const target: WorkerOptions = Utils.convertToQueueBaseOptions(source);

    target.concurrency = undefined;
    target.limiter = Utils.convertToRateLimiterOpts(source.limiter);
    target.skipDelayCheck = undefined;
    target.drainDelay = source.settings
      ? source.settings.drainDelay
      : undefined;
    target.visibilityWindow = undefined;
    target.settings = Utils.convertToAdvancedOpts(source.settings);

    return target;
  }

  static convertToRateLimiterOpts(source: RateLimiter3): RateLimiterOpts {
    if (!source) {
      return;
    }

    const target: RateLimiterOpts = { max: undefined, duration: undefined };

    target.max = source.max;
    target.duration = source.duration;

    if (source.bounceBack !== undefined) {
      console.warn('bounceBack option is not supported');
    }

    return target;
  }

  static convertToAdvancedOpts(source: AdvancedSettings3): AdvancedOpts {
    if (!source) {
      return;
    }

    const target: AdvancedOpts = {};

    target.lockDuration = source.lockDuration;
    target.stalledInterval = source.stalledInterval;
    target.maxStalledCount = source.maxStalledCount;
    target.guardInterval = source.guardInterval;
    target.retryProcessDelay = source.retryProcessDelay;
    target.backoffStrategies = source.backoffStrategies;
    target.drainDelay = source.drainDelay;

    if (source.lockRenewTime !== undefined) {
      console.warn('lockRenewTime option is not supported');
    }

    return target;
  }

  static adaptToCreateClient(
    createClient: (
      type: 'client' | 'subscriber' | 'bclient',
      redisOpts?: IORedis.RedisOptions,
    ) => IORedis.Redis | IORedis.Cluster,
    redis: IORedis.RedisOptions,
  ): (type: ClientType) => IORedis.Redis {
    if (!createClient) {
      return;
    }

    return type => {
      switch (type) {
        case ClientType.blocking:
          return createClient('bclient', redis) as IORedis.Redis;
        case ClientType.normal:
          return createClient('client', redis) as IORedis.Redis;
        default:
          return undefined;
      }
    };
  }

  static parseTypeArg(args: string[] | string): string[] {
    const types = _.chain([])
      .concat(args)
      .join(',')
      .split(/\s*,\s*/g)
      .compact()
      .value();

    return types.length
      ? types
      : ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'];
  }
}
