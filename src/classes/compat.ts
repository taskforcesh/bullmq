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
  QueueEvents,
  Worker,
  Queue,
  QueueScheduler,
  Job,
} from '@src/classes';
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
import {
  JobJson as JobJson,
} from '@src/classes';
import _ from 'lodash';
import url from "url";

export default class Queue3<T = any> extends EventEmitter {

  static readonly DEFAULT_JOB_NAME = "__default__";

  /**
   * The name of the queue
   */
  name: string;

  /**
   * Queue client (used to add jobs, pause queues, etc);
   */
  client: IORedis.Redis;

  /**
   * Array of Redis clients the queue uses
   */
  clients: IORedis.Redis[];

  private opts: QueueOptions3;
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
  private handlers: { [key:string]: Function };

  /**
   * This is the Queue constructor.
   * It creates a new Queue that is persisted in Redis.
   * Everytime the same queue is instantiated it tries to process all the old jobs that may exist from a previous unfinished session.
   */
  constructor(queueName: string, opts?: QueueOptions3);
  constructor(queueName: string, url: string, opts?: QueueOptions3);

  constructor(queueName: string, arg2?: any, arg3?: any) {
    super();

    Object.defineProperties(this, {
      queue: {
        enumerable: false,
        writable: true
      },
      queueScheduler: {
        enumerable: false,
        writable: true
      },
      queueEvents: {
        enumerable: false,
        writable: true
      },
      worker: {
        enumerable: false,
        writable: true
      },
      workerPromise: {
        enumerable: false,
        writable: true
      },
      workerPromiseResolve: {
        enumerable: false,
        writable: true
      },
      workerPromiseReject: {
        enumerable: false,
        writable: true
      },
      client: {
        get: () => { return this.queueScheduler.client; }
      },
      clients: {
        get: () => {
          const clients = [this.queueScheduler.client];
          this.queue && clients.push(this.queue.client);
          this.queueEvents && clients.push(this.queueEvents.client);
          this.worker && clients.push(this.worker.client);
          return clients;
        }
      },
      toKey: {
        get: () => { return this.getQueueScheduler().toKey; }
      }
    });

    let opts: QueueOptions3;

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

    // Forcibly create scheduler to let queue act as expected by default
    this.getQueueScheduler();

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
    await this.getQueueScheduler().waitUntilReady();
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
   * Errors will be passed as a second argument to the "failed" event; results, as a second argument to the "completed" event.
   *
   * If, however, the callback signature does not contain the done argument,
   * a promise must be returned to signal job completion.
   * If the promise is rejected, the error will be passed as a second argument to the "failed" event.
   * If it is resolved, its value will be the "completed" event's second argument.
   *
   * @param concurrency Bull will then call your handler in parallel respecting this maximum value.
   */
  process(concurrency: number, callback: ProcessCallbackFunction3<T>): Promise<void>;
  process(concurrency: number, callback: ProcessPromiseFunction3<T>): Promise<void>;
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
  process(name: string, concurrency: number, callback: ProcessCallbackFunction3<T>): Promise<void>;
  process(name: string, concurrency: number, callback: ProcessPromiseFunction3<T>): Promise<void>;
  process(name: string, concurrency: number, callback: string): Promise<void>;

  process(arg1: any, arg2?: any, arg3?: any): Promise<void> {
    let name: string = Queue3.DEFAULT_JOB_NAME;
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

    if(handlerFile && name !== Queue3.DEFAULT_JOB_NAME) {
      throw new Error('Named processors are not supported with sandboxed workers');
    }

    this.handlers[name] = handler;

    if(! this.worker) {
      const workerOpts = Utils.convertToWorkerOptions(this.opts);
      workerOpts.concurrency = concurrency;
      if(handlerFile) {
        this.worker = new Worker(this.name, handlerFile, workerOpts);
      } else {
        this.worker = new Worker(this.name, Queue3.createProcessor(this), workerOpts);
      }
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
  add(data: T, opts?: JobOptions3): Promise<Job3<T>>;

  /**
   * Creates a new named job and adds it to the queue.
   * If the queue is empty the job will be executed directly,
   * otherwise it will be placed in the queue and executed as soon as possible.
   */
  add(name: string, data: T, opts?: JobOptions3): Promise<Job3<T>>;

  async add(arg1: any, arg2?: any, arg3?: any): Promise<Job3<T>> {
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

    if (opts.repeat) {
      const result = await this.getQueue().repeat.addNextRepeatableJob(
        name, data,
        Utils.convertToJobsOpts(opts),
        (opts.repeat as any).jobId,
        true
      );
      return Utils.convertToJob3(result, this);
    } else {
      const result = await this.getQueue().append(name, data, Utils.convertToJobsOpts(opts));
      return Utils.convertToJob3(result, this);
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
  close(): Promise<any> {
    const promises = [];

    if(this.queueScheduler) {
      promises.push(this.queueScheduler.close());
    }
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
  async getJob(jobId: JobId3): Promise<Job3<T> | null>{
    const job = await this.getQueue().getJob(Utils.convertToJobId(jobId));
    return Utils.convertToJob3(job, this);
  }


  /**
   * Returns a promise that will return an array with the waiting jobs between start and end.
   */
  async getWaiting(start: number = 0, end: number = -1): Promise<Array<Job3<T>>>{
    const result: Job[] = await this.getQueue().getWaiting(start, end);
    return result.map(job => Utils.convertToJob3(job, this));
  }


  /**
   * Returns a promise that will return an array with the active jobs between start and end.
   */
  async getActive(start: number = 0, end: number = -1): Promise<Array<Job3<T>>>{
    const result: Job[] = await this.getQueue().getActive(start, end);
    return result.map(job => Utils.convertToJob3(job, this));
  }


  /**
   * Returns a promise that will return an array with the delayed jobs between start and end.
   */
  async getDelayed(start: number = 0, end: number = -1): Promise<Array<Job3<T>>>{
    const result: Job[] = await this.getQueue().getDelayed(start, end);
    return result.map(job => Utils.convertToJob3(job, this));
  }


  /**
   * Returns a promise that will return an array with the completed jobs between start and end.
   */
  async getCompleted(start: number = 0, end: number = -1): Promise<Array<Job3<T>>>{
    const result: Job[] = await this.getQueue().getCompleted(start, end);
    return result.map(job => Utils.convertToJob3(job, this));
  }


  /**
   * Returns a promise that will return an array with the failed jobs between start and end.
   */
  async getFailed(start: number = 0, end: number = -1): Promise<Array<Job3<T>>>{
    const result: Job[] = await this.getQueue().getFailed(start, end);
    return result.map(job => Utils.convertToJob3(job, this));
  }


  /**
   * Returns JobInformation of repeatable jobs (ordered descending). Provide a start and/or an end
   * index to limit the number of results. Start defaults to 0, end to -1 and asc to false.
   */
  getRepeatableJobs(start: number = 0, end: number = -1, asc: boolean = false): Promise<JobInformation3[]>{
    return this.getQueue().repeat.getRepeatableJobs(start, end, asc);
  }


  /**
   * ???
   */
  async nextRepeatableJob(name: string, data: any, opts: JobOptions3, skipCheckExists?: boolean): Promise<Job3<T>>{
    const result = await this.getQueue().repeat.addNextRepeatableJob(
      name || Queue3.DEFAULT_JOB_NAME,
      data,
      Utils.convertToJobsOpts(opts),
      (opts.repeat as any).jobId,
      skipCheckExists
    );
    return Utils.convertToJob3(result, this);
  }


  /**
   * Removes a given repeatable job. The RepeatOptions and JobId needs to be the same as the ones
   * used for the job when it was added.
   */
  removeRepeatable(repeat: (CronRepeatOptions3 | EveryRepeatOptions3) & { jobId?: JobId3 }): Promise<void>

  /**
   * Removes a given repeatable job. The RepeatOptions and JobId needs to be the same as the ones
   * used for the job when it was added.
   *
   * name: The name of the to be removed job
   */
  removeRepeatable(name: string, repeat: (CronRepeatOptions3 | EveryRepeatOptions3) & { jobId?: JobId3 }): Promise<void>;

  async removeRepeatable(arg1: any, arg2?: any): Promise<void> {
    let name: string = Queue3.DEFAULT_JOB_NAME;
    let repeat: (CronRepeatOptions3 | EveryRepeatOptions3) & { jobId?: JobId3 };

    if(typeof arg1 === 'string') {
      name = arg1;
      repeat = arg2;
    } else {
      repeat = arg1;
    }
    return this.getQueue().repeat.removeRepeatable(name,
      Utils.convertToRepeatOpts(repeat), Utils.convertToJobId(repeat.jobId))
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
      cron: tokens[4]
    };

    const queueKey = repeat.toKey('');
    return (<any>repeat.client).removeRepeatable(
      repeat.keys.repeat,
      repeat.keys.delayed,
      data.id,
      repeatJobKey,
      queueKey
    );
  }

  /**
   * Returns a promise that will return an array of job instances of the given types.
   * Optional parameters for range and ordering are provided.
   */
  async getJobs(types: string[], start: number = 0, end: number = -1, asc: boolean = false): Promise<Array<Job3<T>>> {
    const result: Job[] = await this.getQueue().getJobs(types, start, end, asc);
    return result.map(job => Utils.convertToJob3(job, this));
  }

  /**
   * Returns a object with the logs according to the start and end arguments. The returned count
   * value is the total amount of logs, useful for implementing pagination.
   */
  getJobLogs(jobId: string, start: number = 0, end: number = -1): Promise<{ logs: string[], count: number }> {
    throw new Error('Not supported');
  }

  /**
   * Returns a promise that resolves with the job counts for the given queue.
   */
  async getJobCounts(): Promise<JobCounts3> {
    const result = await this.getQueue().getJobCounts();
    return Utils.convertToJobCounts3(result);
  }

  /**
   * Returns a promise that resolves with the job counts for the given queue of the given types.
   */
  async getJobCountByTypes(types: string[] | string): Promise<number> {
    return this.getQueue().getJobCountByTypes(...types);
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
   * @param status Status of the job to clean. Values are completed, wait, active, delayed, and failed. Defaults to completed.
   * @param limit Maximum amount of jobs to clean per call. If not provided will clean all matching jobs.
   */
  clean(grace: number, status?: JobStatusClean3, limit?: number): Promise<Array<Job3<T>>> {
    throw new Error('Not supported');
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
  };

  off(event: string | symbol, listener: (...args: any[]) => void): this {
    return this.removeListener(event, listener);
  }

  removeListener(event: string | symbol, listener: (...args: any[]) => void): this {

    const global = this.queueEvents;

    switch (event) {
      case 'active':
        this.onWorkerInit((worker) => {
          worker.removeListener('active', listener);
        });
        break;
      case 'completed':
        this.onWorkerInit((worker) => {
          worker.removeListener('completed', listener);
        });
        break;
      case 'drained':
        this.onWorkerInit((worker) => {
          worker.removeListener('drained', listener);
        });
        break;
      case 'failed':
        this.onWorkerInit((worker) => {
          worker.removeListener('failed', listener);
        });
        break;
      case 'paused':
        this.onWorkerInit((worker) => {
          worker.removeListener('paused', listener);
        });
        this.onQueueInit((queue) => {
          queue.removeListener('paused', listener);
        });
        break;
      case 'resumed':
        this.onWorkerInit((worker) => {
          worker.removeListener('resumed', listener);
        });
        this.onQueueInit((queue) => {
          queue.removeListener('resumed', listener);
        });
        break;
      case 'progress':
        this.onWorkerInit((worker) => {
          worker.removeListener('progress', listener);
        });
        this.onQueueInit((queue) => {
          queue.removeListener('progress', listener);
        });
        break;
      case 'global:active':
        global && global.removeListener('active', listener);
        break;
      case 'global:completed':
        global && global.removeListener('completed', listener);
        break;
      case  'global:drained':
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
  getWorkers(): Promise<{[key: string]: string }[]> {
    return this.getQueue().getWorkers();
  }

  /**
   * Returns Queue name in base64 encoded format
   */
  base64Name(): string {
    return (this.getQueue() as any).base64Name();
  };

  /**
   * Returns Queue name with keyPrefix (default: 'bull')
   */
  clientName(): string {
    return (this.getQueue() as any).clientName();
  };

  /**
   * Returns Redis clients array which belongs to current Queue from string with all redis clients
   *
   * @param list String with all redis clients
   */
  parseClientList(list: string): {[key: string]: string }[] {
    return (this.getQueue() as any).parseClientList(list);
  };

  private getQueueScheduler() {
    if (! this.queueScheduler) {
      this.queueScheduler = new QueueScheduler(this.name, Utils.convertToQueueKeeperOptions(this.opts));
    }
    return this.queueScheduler;
  }

  private getQueue() {
    if (! this.queue) {
      this.queue = new Queue(this.name, Utils.convertToQueueOptions(this.opts));
      this.queuePromiseResolve(this.queue);
    }
    return this.queue;
  }

  private getQueueEvents() {
    if (! this.queueEvents) {
      this.queueEvents = new QueueEvents(this.name, Utils.convertToQueueEventsOptions(this.opts));
    }
    return this.queueEvents;
  }

  private onQueueInit(cb: (queue: Queue) => void) {
    this.queuePromise = this.queuePromise.then(
      (_) => { cb(this.queue); return this.queue; }
    ).catch((_) => { return this.queue; });
  }

  private onWorkerInit(cb: (worker: Worker) => void) {
    this.workerPromise = this.workerPromise.then(
      (_) => { cb(this.worker); return this.worker; }
    ).catch((_) => { return this.worker; });
  }

  private registerEventHandler(once: boolean,
                               event: string | symbol,
                               listener: (...args: any[]) => void): this {
    switch (event) {
      case 'active':
        console.warn(`jobPromise won't be available on 'active' event handler`);
        if (once) {
          this.onWorkerInit((worker) => {
            worker.once('active', (job, jobPromise, prev) => {
              listener(job, Utils.getFakeJobPromise3(), prev);
            });
          });
        } else {
          this.onWorkerInit((worker) => {
            worker.on('active', (job, jobPromise, prev) => {
              listener(job, Utils.getFakeJobPromise3(), prev);
            });
          });
        }
        break;
      case 'cleaned':
        console.warn(`listening on 'cleaned' event is not supported`);
        break;
      case 'completed':
        if (once) {
          this.onWorkerInit((worker) => {
            worker.once('completed', (job, result, prev) => {
              listener(job, result, prev);
            });
          });
        } else {
          this.onWorkerInit((worker) => {
            worker.on('completed', (job, result, prev) => {
              listener(job, result, prev);
            });
          });
        }
        break;
      case 'drained':
        if (once) {
          this.onWorkerInit((worker) => {
            worker.once('drained', () => {
              listener();
            });
          });
        } else {
          this.onWorkerInit((worker) => {
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
          this.onWorkerInit((worker) => {
            worker.once('failed', (job, error, prev) => {
              listener(job, error, prev);
            });
          });
        } else {
          this.onWorkerInit((worker) => {
            worker.on('failed', (job, error, prev) => {
              listener(job, error, prev);
            });
          });
        }
        break;
      case 'paused':
        if (once) {
          this.onWorkerInit((worker) => {
            worker.once('paused', () => {
              listener();
            });
          });
          this.onQueueInit((queue) => {
            queue.once('paused', () => {
              listener();
            });
          });
        } else {
          this.onWorkerInit((worker) => {
            worker.on('paused', () => {
              listener();
            });
          });
          this.onQueueInit((queue) => {
            queue.on('paused', () => {
              listener();
            });
          });
        }
        break;
      case 'resumed':
        if (once) {
          this.onWorkerInit((worker) => {
            worker.once('resumed', () => {
              listener();
            });
          });
          this.onQueueInit((queue) => {
            queue.once('resumed', () => {
              listener();
            });
          });
        } else {
          this.onWorkerInit((worker) => {
            worker.on('resumed', () => {
              listener();
            });
          });
          this.onQueueInit((queue) => {
            queue.on('resumed', () => {
              listener();
            });
          });
        }
        break;
      case 'progress':
        if (once) {
          this.onWorkerInit((worker) => {
            worker.once('progress', (job, progress) => {
              listener(job, progress);
            });
          });
          this.onQueueInit((queue) => {
            queue.once('progress', () => {
              listener();
            });
          });
        } else {
          this.onWorkerInit((worker) => {
            worker.on('progress', (job, progress) => {
              listener(job, progress);
            });
          });
          this.onQueueInit((queue) => {
            queue.on('progress', () => {
              listener();
            });
          });
        }
        break;
      case 'stalled':
        console.warn(`listening on 'stalled' event is not supported`);
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
          this.getQueueEvents().once('completed', ({ jobId, returnvalue, prev }) => {
            listener(jobId, returnvalue, prev || 'active');
          });
        } else {
          this.getQueueEvents().on('completed', ({ jobId, returnvalue, prev }) => {
            listener(jobId, returnvalue, prev || 'active');
          });
        }
        break;
      case  'global:drained':
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
          this.getQueueEvents().once('failed', ({ jobId, failedReason, prev }) => {
            listener(jobId, failedReason, prev || 'active');
          });
        } else {
          this.getQueueEvents().on('failed', ({ jobId, failedReason, prev }) => {
            listener(jobId, failedReason, prev || 'active');
          });
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
    }
    return this;
  }

  private static createProcessor(queue: Queue3): Processor {

    return (job: Job): Promise<any> => {
      const name = job.name || Queue3.DEFAULT_JOB_NAME;
      const handler = queue.handlers[name] || queue.handlers['*'];
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
          handler.apply(null, [Utils.convertToJob3(job, queue), done]);
        } else {
          try {
            return resolve(handler.apply(null, [Utils.convertToJob3(job, queue)]));
          } catch (err) {
            return reject(err);
          }
        }
      });
    };
  }

}

export class Job3<T = any> {

  id: JobId3;

  /**
   * The custom data passed when the job was created
   */
  data: T;

  /**
   * Options of the job
   */
  opts: JobOptions3;

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
  queue: Queue3<T>;

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

  private _progress: any;
  private delay: number;
  private failedReason: string;

  private job: Job;

  constructor(queue: Queue3, data: any, opts?: JobOptions3);
  constructor(queue: Queue3, name: string, data: any, opts?: JobOptions3);

  constructor(queue: Queue3, arg2: any, arg3?: any, arg4?: any) {

    Object.defineProperties(this, {
      job: {
        enumerable: false,
        writable: true
      },
      id: {
        get: () => { return Utils.convertToJobId3(this.job.id); },
        set: (val) => { this.job.id = Utils.convertToJobId(val); }
      },
      name: {
        get: () => { return this.job.name; },
        set: (val) => { this.job.name = val; }
      },
      data: {
        get: () => { return this.job.data; },
        set: (val) => { this.job.data = val; }
      },
      opts: {
        get: () => { return Utils.convertToJobOptions3(this.job.opts); },
        set: (val) => { this.job.opts = Utils.convertToJobsOpts(val); }
      },
      _progress: {
        get: () => { return this.job.progress; },
        set: (val) => { this.job.progress = val; }
      },
      delay: {
        get: () => { return this.job.opts && this.job.opts.delay; },
        set: (val) => { this.job.opts = { ...this.job.opts, delay: val }; }
      },
      timestamp: {
        get: () => { return this.job.timestamp; },
        set: (val) => { this.job.timestamp = val; }
      },
      finishedOn: {
        get: () => { return (this.job as any).finishedOn; },
        set: (val) => { (this.job as any).finishedOn = val; }
      },
      processedOn: {
        get: () => { return (this.job as any).processedOn; },
        set: (val) => { (this.job as any).processedOn = val; }
      },
      failedReason: {
        get: () => { return (this.job as any).failedReason; },
        set: (val) => { (this.job as any).failedReason = val; }
      },
      attemptsMade: {
        get: () => { return (this.job as any).attemptsMade; },
        set: (val) => { (this.job as any).attemptsMade = val; }
      },
      stacktrace: {
        get: () => { return this.job.stacktrace; },
        set: (val) => { this.job.stacktrace = val; }
      },
      returnvalue: {
        get: () => { return this.job.returnvalue; },
        set: (val) => { this.job.returnvalue = val; }
      },
      toKey: {
        enumerable: false,
        get: () => { return (this.job as any).toKey; }
      }
    });


    let name: string = Queue3.DEFAULT_JOB_NAME;
    let data: any;
    let opts: JobOptions3;

    if (typeof arg2 !== 'string') {
      // formally we cannot resolve args when data is string
      data = arg2;
      opts = arg3;
    } else {
      name = arg2;
      data = arg3;
      opts = arg4;
    }

    this.queue = queue;
    this.job = new Job((queue as any).getQueue(), name, data, Utils.convertToJobsOpts(opts));
    this.stacktrace = [];
  }

  /**
   * Report progress on a job
   */
  progress(value: any): Promise<void> {
    return this.job.updateProgress(value);
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
    return this.job.isCompleted();
  }

  /**
   * Returns a promise resolving to a boolean which, if true, current job's state is failed
   */
  isFailed(): Promise<boolean> {
    return this.job.isFailed();
  }

  /**
   * Returns a promise resolving to a boolean which, if true, current job's state is delayed
   */
  isDelayed(): Promise<boolean> {
    return this.job.isDelayed();
  }

  /**
   * Returns a promise resolving to a boolean which, if true, current job's state is active
   */
  isActive(): Promise<boolean> {
    return this.job.isActive();
  }

  /**
   * Returns a promise resolving to a boolean which, if true, current job's state is wait
   */
  isWaiting(): Promise<boolean> {
    return this.job.isWaiting();
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
  getState(): Promise<JobStatus3> {
    throw new Error('Not supported');
  }

  /**
   * Update a specific job's data. Promise resolves when the job has been updated.
   */
  update(data: any): Promise<void> {
    return this.job.update(data);
  }

  /**
   * Removes a job from the queue and from any lists it may be included in.
   * The returned promise resolves when the job has been removed.
   */
  remove(): Promise<void> {
    return this.job.remove();
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
  finished(watchdog = 5000, ttl?: number): Promise<any> {
    return this.job.waitUntilFinished((this.queue as any).getQueueEvents(), watchdog, ttl);
  }

  /**
   * Moves a job to the `completed` queue. Pulls a job from 'waiting' to 'active'
   * and returns a tuple containing the next jobs data and id. If no job is in the `waiting` queue, returns null.
   */
  async moveToCompleted(returnValue?: string, ignoreLock?: boolean): Promise<[SerializedJob3, JobId3] | null> {
    if(ignoreLock) {
      console.warn("ignoreLock is not supported");
    }
    const result = await this.job.moveToCompleted(returnValue);
    if(result) {
      return [Utils.convertToSerializedJob3(result[0]), Utils.convertToJobId3(result[1])];
    }
  }

  /**
   * Moves a job to the `failed` queue. Pulls a job from 'waiting' to 'active'
   * and returns a tuple containing the next jobs data and id. If no job is in the `waiting` queue, returns null.
   */
  async moveToFailed(errorInfo: any, ignoreLock?: boolean): Promise<[any, JobId3] | null> {
    if(ignoreLock) {
      console.warn("ignoreLock is not supported");
    }
    await this.job.moveToFailed(errorInfo);
    return null;
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
  toJSON(): JobJson3<T> {
    const result = {
      id: this.id,
      name: this.name,
      data: this.data,
      opts: { ...this.opts },
      progress: this._progress,
      delay: this.delay, // Move to opts
      timestamp: this.timestamp,
      attemptsMade: this.attemptsMade,
      failedReason: this.failedReason,
      stacktrace: this.stacktrace || null,
      returnvalue: this.returnvalue || null,
      finishedOn: this.finishedOn || null,
      processedOn: this.processedOn || null
    };
    if(! result.data) {
      (result as any).data = {};
    }
    return result;
  }


  private toData(): SerializedJob3 {
    const target: SerializedJob3 = {
      id: undefined,
      name: undefined,
      data: undefined,
      opts: undefined,
      progress: undefined,
      delay: undefined,
      timestamp: undefined,
      attemptsMade: undefined,
      failedReason: undefined,
      stacktrace: undefined,
      returnvalue: undefined,
      finishedOn: undefined,
      processedOn: undefined
    };
    const json = this.toJSON();
    target.id = undefined;
    target.name = undefined;
    target.data = JSON.stringify(json.data);
    target.opts = JSON.stringify(json.opts);
    target.progress = undefined;
    target.delay = undefined;
    target.timestamp = undefined;
    target.attemptsMade = undefined;
    target.failedReason = JSON.stringify(json.failedReason);
    target.stacktrace = JSON.stringify(json.stacktrace);
    target.returnvalue = JSON.stringify(json.returnvalue);
    target.finishedOn = undefined;
    target.processedOn = undefined;
    return target;
  };

  private static fromJSON<T>(queue: Queue3, json: SerializedJob3, jobId?: JobId3) {
    const data = JSON.parse(json.data || '{}');
    const opts = JSON.parse(json.opts || '{}');

    const job = new Job3(queue, json.name || Queue3.DEFAULT_JOB_NAME, data, opts);

    job.id = json.id || jobId;
    job._progress = JSON.parse(json.progress || '0');
    job.delay = parseInt(json.delay);
    job.timestamp = parseInt(json.timestamp);
    if (json.finishedOn) {
      job.finishedOn = parseInt(json.finishedOn);
    }

    if (json.processedOn) {
      job.processedOn = parseInt(json.processedOn);
    }

    job.failedReason = json.failedReason;
    job.attemptsMade = parseInt(json.attemptsMade) || 0;

    job.stacktrace = [];
    try {
      const parsed = JSON.parse(json.stacktrace);
      if(Array.isArray(parsed)) {
        job.stacktrace = parsed;
      }
    } catch (e) {
    }

    if (typeof json.returnvalue === 'string') {
      try {
        job.returnvalue = JSON.parse(json.returnvalue);
      } catch (e) {
      }
    }

    return job;
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
  createClient?(type: 'client' | 'subscriber' | 'bclient', redisOpts?: IORedis.RedisOptions): IORedis.Redis | IORedis.Cluster;

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

export type JobId3 = number | string;

export type ProcessCallbackFunction3<T> = (job: Job3<T>, done: DoneCallback3) => void;
export type ProcessPromiseFunction3<T> = (job: Job3<T>) => Promise<void>;

export type JobStatus3 = 'completed' | 'waiting' | 'active' | 'delayed' | 'failed';
export type JobStatusClean3 = 'completed' | 'wait' | 'active' | 'delayed' | 'failed';

export interface SerializedJob3 {
  id: JobId3,
  name: string,
  data: string,
  opts: string,
  progress: any,
  delay: string,
  timestamp: string,
  attemptsMade: string,
  failedReason: any,
  stacktrace: string,
  returnvalue: any,
  finishedOn: string,
  processedOn: string
}

export interface JobJson3<T> {
  id: JobId3,
  name: string,
  data: T,
  opts: JobOptions3,
  progress: any,
  delay?: number,
  timestamp: number,
  attemptsMade: number,
  failedReason: any,
  stacktrace: string[] | null,
  returnvalue: any,
  finishedOn: number,
  processedOn: number
}

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
  jobId?: JobId3;

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

export type ActiveEventCallback3<T = any> = (job: Job3<T>, jobPromise?: JobPromise3) => void;

export type StalledEventCallback3<T = any> = (job: Job3<T>) => void;

export type ProgressEventCallback3<T = any> = (job: Job3<T>, progress: any) => void;

export type CompletedEventCallback3<T = any> = (job: Job3<T>, result: any) => void;

export type FailedEventCallback3<T = any> = (job: Job3<T>, error: Error) => void;

export type CleanedEventCallback3<T = any> = (jobs: Array<Job3<T>>, status: JobStatusClean3) => void;

export type RemovedEventCallback3<T = any> = (job: Job3<T>) => void;

export type WaitingEventCallback3 = (jobId: JobId3) => void;

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

  static convertToJobId(id: JobId3): string {
    if(id !== undefined) {
      if(typeof id === "string") {
        return id;
      } else {
        return id.toString();
      }
    }
  }

  static convertToJobId3(id: string): JobId3 {
    if(id !== undefined) {
      if((/^\d+$/g).test(id)) {
        return parseInt(id);
      }
      return id;
    }
  }

  static convertToJob3(source: Job, queue: Queue3<any>): Job3 {
    if(source) {
      return new Job3(queue, source.name, source.data, Utils.convertToJobOptions3(source.opts));
    }
  };

  static convertToJobOptions3(source: JobsOpts): JobOptions3 {
    if(! source) {
      return;
    }

    const target: JobOptions3 = {};

    (target as any).timestamp = source.timestamp;
    target.priority = source.priority;
    target.delay = source.delay;
    target.attempts = source.attempts;
    target.repeat = Utils.convertToRepeatOptions3(source.repeat);

    if(source.backoff !== undefined) {
      if(typeof source.backoff === "number") {
        target.backoff = source.backoff;
      } else {
        target.backoff = Utils.convertToBackoffOptions3(source.backoff);
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

  static convertToQueueBaseOptions(source: QueueOptions3): QueueBaseOptions {
    if(! source) {
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
    if(! source) {
      return;
    }

    const target: QueueOptions = Utils.convertToQueueBaseOptions(source);

    target.defaultJobOptions = Utils.convertToJobsOpts(source.defaultJobOptions);
    target.createClient = Utils.adaptToCreateClient(source.createClient, source.redis);

    return target;
  }

  static convertToQueueEventsOptions(source: QueueOptions3): QueueEventsOptions {
    if(! source) {
      return;
    }

    const target: QueueEventsOptions = Utils.convertToQueueBaseOptions(source);

    target.lastEventId = undefined;
    target.blockingTimeout = undefined;

    return target;
  }

  static convertToQueueKeeperOptions(source: QueueOptions3): QueueKeeperOptions {
    if(! source) {
      return;
    }

    const target: QueueKeeperOptions = Utils.convertToQueueBaseOptions(source);

    if(source.settings) {
      target.maxStalledCount = source.settings.maxStalledCount;
      target.stalledInterval = source.settings.stalledInterval;
    }

    return target;
  }

  static convertToJobsOpts(source: JobOptions3): JobsOpts {
    if(! source) {
      return;
    }

    const target: JobsOpts = {};

    target.timestamp = (source as any).timestamp;
    target.priority = source.priority;
    target.delay = source.delay;
    target.attempts = source.attempts;
    target.repeat = Utils.convertToRepeatOpts(source.repeat);

    if(source.backoff !== undefined) {
      if(typeof source.backoff === "number") {
        target.backoff = source.backoff;
      } else {
        target.backoff = Utils.convertToBackoffOpts(source.backoff);
      }
    }

    target.lifo = source.lifo;
    target.timeout = source.timeout;

    if(source.jobId !== undefined) {
      target.jobId = Utils.convertToJobId(source.jobId);
    }

    if(source.removeOnComplete !== undefined) {
      if(typeof source.removeOnComplete === "number") {
        console.warn("numeric removeOnComplete option is not supported");
      } else {
        target.removeOnComplete = source.removeOnComplete;
      }
    }

    if(source.removeOnFail !== undefined) {
      if(typeof source.removeOnFail === "number") {
        console.warn("numeric removeOnFail option is not supported");
      } else {
        target.removeOnFail = source.removeOnFail;
      }
    }
    target.stackTraceLimit = source.stackTraceLimit;
    return target;
  }

  static convertToRepeatOpts(source: CronRepeatOptions3 | EveryRepeatOptions3): RepeatOpts {
    if(! source) {
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

  static convertToRepeatOptions3(source: RepeatOpts): CronRepeatOptions3 | EveryRepeatOptions3 {
    if(! source) {
      return;
    }

    if(source.cron) {
      const target: CronRepeatOptions3 = { cron: undefined };
      target.cron = (source as CronRepeatOptions3).cron;
      target.tz = (source as CronRepeatOptions3).tz;
      target.startDate = (source as CronRepeatOptions3).startDate;
      target.endDate = (source as CronRepeatOptions3).endDate;
      target.limit = (source as EveryRepeatOptions3).limit;
      return target;
    } else {
      const target: EveryRepeatOptions3 = { every: undefined };
      target.tz = (source as CronRepeatOptions3).tz;
      target.endDate = (source as CronRepeatOptions3).endDate;
      target.limit = (source as EveryRepeatOptions3).limit;
      target.every = (source as EveryRepeatOptions3).every;
      return target;
    }
  }

  static convertToBackoffOpts(source: BackoffOptions3): BackoffOpts {
    if(! source) {
      return;
    }

    const target: BackoffOpts = { type: undefined, delay: undefined };

    target.type = source.type;
    target.delay = source.delay;

    return target;
  }

  static convertToBackoffOptions3(source: BackoffOpts): BackoffOptions3 {
    if(! source) {
      return;
    }

    const target: BackoffOptions3 = { type: undefined };

    target.type = source.type;
    target.delay = source.delay;

    return target;
  }

  static convertToWorkerOptions(source: QueueOptions3): WorkerOptions {
    if(! source) {
      return;
    }
    const target: WorkerOptions = Utils.convertToQueueBaseOptions(source);

    target.concurrency = undefined;
    target.limiter = Utils.convertToRateLimiterOpts(source.limiter);
    target.skipDelayCheck = undefined;
    target.drainDelay = undefined;
    target.visibilityWindow = undefined;
    target.settings = Utils.convertToAdvancedOpts(source.settings);

    return target;
  }

  static convertToRateLimiterOpts(source: RateLimiter3): RateLimiterOpts {
    if(! source) {
      return;
    }

    const target: RateLimiterOpts = { max: undefined, duration: undefined };

    target.max = source.max;
    target.duration = source.duration;

    if(source.bounceBack !== undefined) {
      console.warn("bounceBack option is not supported");
    }

    return target;
  }

  static convertToAdvancedOpts(source: AdvancedSettings3): AdvancedOpts {
    if(! source) {
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

    if(source.lockRenewTime !== undefined) {
      console.warn("lockRenewTime option is not supported");
    }

    return target;
  }

  static convertToJobCounts3(source: { [key:string]: number }): JobCounts3 {
    if(source) {
      const target: JobCounts3 = { active: undefined,
        completed: undefined, failed: undefined, delayed: undefined, waiting: undefined };
      Object.keys(source).forEach((key) => {
        if(typeof source[key] === "number") {
          switch(key) {
            case 'active':
              target.active = source[key]; break;
            case 'completed':
              target.completed = source[key]; break;
            case  'failed':
              target.failed = source[key]; break;
            case  'delayed':
              target.delayed = source[key]; break;
            case  'waiting':
              target.waiting = source[key]; break;
          }
        }
      });
      return target;
    }
  }

  static convertToSerializedJob3(source: JobJson): SerializedJob3 {
    if(source) {
      const target: SerializedJob3 = {
        id: undefined,
        name: undefined,
        data: undefined,
        opts: undefined,
        progress: undefined,
        delay: undefined,
        timestamp: undefined,
        attemptsMade: undefined,
        failedReason: undefined,
        stacktrace: undefined,
        returnvalue: undefined,
        finishedOn: undefined,
        processedOn: undefined
      };
      target.id = source.id;
      target.name = source.name;
      target.data = source.data;
      target.opts = source.opts;
      target.progress = source.progress;
      if(source.opts) {
        try {
          target.delay = JSON.parse(source.opts).delay;
        } catch(e) {
        }
      }
      if(source.timestamp !== undefined) {
        target.timestamp = source.timestamp.toString();
      }
      if(source.attemptsMade !== undefined) {
        target.attemptsMade = source.attemptsMade.toString();
      }
      target.failedReason = source.failedReason;
      target.stacktrace = source.stacktrace;
      target.returnvalue = source.returnvalue;
      if(source.finishedOn !== undefined) {
        target.finishedOn = source.finishedOn.toString();
      }
      if(source.processedOn !== undefined) {
        target.processedOn = source.processedOn.toString();
      }
      return target;
    }
  }

  static adaptToCreateClient(
    createClient: (type: 'client' | 'subscriber' | 'bclient', redisOpts?: IORedis.RedisOptions) => IORedis.Redis | IORedis.Cluster,
    redis: IORedis.RedisOptions): (type: ClientType) => IORedis.Redis {
    if(! createClient) {
      return;
    }

    return ((type) => {
      switch(type) {
        case ClientType.blocking:
          return createClient('bclient', redis) as IORedis.Redis;
        case ClientType.normal:
          return createClient('client', redis) as IORedis.Redis;
        default:
          return undefined;
      }
    });
  }

  static getFakeJobPromise3() {
    const msg = 'jobPromise is not supported';
    return {
      then: () => { console.warn(msg + " (then() call is a no-op)"); },
      catch: () => { console.warn(msg + " (catch() call is a no-op)"); },
      finally: () => { console.warn(msg + " (finally() call is a no-op)"); },
      cancel: () => { console.warn(msg + " (cancel() call is a no-op)"); },
    }
  }

}
