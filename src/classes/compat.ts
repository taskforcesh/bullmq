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

import { EventEmitter } from 'events';
import { QueueEvents, Worker, Queue, QueueScheduler, Job } from './';
import {
  JobsOptions,
  QueueOptions,
  RepeatOptions,
  QueueEventsOptions,
  QueueSchedulerOptions,
  WorkerOptions,
  Processor,
} from '../interfaces';
import IORedis = require('ioredis');

type CommonOptions = QueueSchedulerOptions &
  QueueOptions &
  WorkerOptions &
  QueueEventsOptions;

export class Queue3<T = any> extends EventEmitter {
  /**
   * The name of the queue
   */
  name: string;
  queueEvents: QueueEvents;

  private opts: CommonOptions;
  private readonly queue: Queue;
  private worker: Worker;
  private queueScheduler: QueueScheduler;

  /**
   * This is the Queue constructor.
   * It creates a new Queue that is persisted in Redis.
   * Everytime the same queue is instantiated it tries to process all the old jobs
   * that may exist from a previous unfinished session.
   */
  constructor(name: string, opts?: CommonOptions) {
    super();

    this.opts = opts;
    this.name = name;

    this.queue = new Queue(this.name, this.opts);
  }

  /**
   * Returns a promise that resolves when Redis is connected and the queue is ready to accept jobs.
   * This replaces the `ready` event emitted on Queue in previous verisons.
   */
  async isReady(): Promise<this> {
    await this.queue.client;
    if (this.queueEvents) {
      await this.queueEvents.client;
    }
    return this;
  }

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
  async process(processor: string | Processor) {
    if (this.worker) {
      throw new Error('Queue3.process() cannot be called twice');
    }

    this.worker = new Worker(this.name, processor, this.opts);
    this.queueScheduler = new QueueScheduler(this.name, this.opts);
    await this.worker.client;
  }

  add(jobName: string, data: any, opts?: JobsOptions): Promise<Job> {
    return this.queue.add(jobName, data, opts);
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
  async pause(): Promise<void> {
    return this.queue.pause();
  }

  async pauseWorker(doNotWaitActive?: boolean): Promise<void> {
    if (!this.worker) {
      throw new Error('Worker is not initialized, call process() first');
    }
    return this.worker.pause(doNotWaitActive);
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
  async resume(): Promise<void> {
    return this.queue.resume();
  }

  async resumeWorker(): Promise<void> {
    if (!this.worker) {
      throw new Error('Worker is not initialized, call process() first');
    }
    return this.worker.resume();
  }

  isWorkerPaused(): boolean {
    return this.worker && this.worker.isPaused();
  }

  /**
   * Returns a promise that returns the number of jobs in the queue, waiting or paused.
   * Since there may be other processes adding or processing jobs,
   * this value may be true only for a very small amount of time.
   */
  count(): Promise<number> {
    return this.queue.count();
  }

  /**
   * Empties a queue deleting all the input lists and associated jobs.
   */
  async empty(): Promise<void> {
    await this.queue.drain();
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
    return this.queue.getJob(jobId);
  }

  /**
   * Returns a promise that will return an array with the waiting jobs between start and end.
   */
  getWaiting(start = 0, end = -1): Promise<Array<Job>> {
    return this.queue.getWaiting(start, end);
  }

  /**
   * Returns a promise that will return an array with the active jobs between start and end.
   */
  getActive(start = 0, end = -1): Promise<Array<Job>> {
    return this.queue.getActive(start, end);
  }

  /**
   * Returns a promise that will return an array with the delayed jobs between start and end.
   */
  getDelayed(start = 0, end = -1): Promise<Array<Job>> {
    return this.queue.getDelayed(start, end);
  }

  /**
   * Returns a promise that will return an array with the completed jobs between start and end.
   */
  getCompleted(start = 0, end = -1): Promise<Array<Job>> {
    return this.queue.getCompleted(start, end);
  }

  /**
   * Returns a promise that will return an array with the failed jobs between start and end.
   */
  async getFailed(start = 0, end = -1): Promise<Array<Job>> {
    return this.queue.getFailed(start, end);
  }

  /**
   * Returns JobInformation of repeatable jobs (ordered descending). Provide a start and/or an end
   * index to limit the number of results. Start defaults to 0, end to -1 and asc to false.
   */
  async getRepeatableJobs(
    start = 0,
    end = -1,
    asc = false,
  ): Promise<JobInformation3[]> {
    const repeat = await this.queue.repeat;
    return repeat.getRepeatableJobs(start, end, asc);
  }

  /**
   * ???
   */
  async nextRepeatableJob(
    name: string,
    data: any,
    opts?: JobsOptions,
    skipCheckExists?: boolean,
  ): Promise<Job> {
    const repeat = await this.queue.repeat;
    return repeat.addNextRepeatableJob(name, data, opts, skipCheckExists);
  }

  /**
   * Removes a given repeatable job. The RepeatOptions and JobId needs to be the same as the ones
   * used for the job when it was added.
   *
   * name: The name of the to be removed job
   */
  async removeRepeatable(name: string, opts: RepeatOptions): Promise<void> {
    const repeat = await this.queue.repeat;
    return repeat.removeRepeatable(name, opts, opts.jobId);
  }

  /**
   * Removes a given repeatable job by key.
   */
  async removeRepeatableByKey(repeatJobKey: string): Promise<void> {
    const repeat = await this.queue.repeat;
    const client = await repeat.client;

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
    return (<any>client).removeRepeatable(
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
    types: string[] | string,
    start = 0,
    end = -1,
    asc = false,
  ): Promise<Array<Job>> {
    return this.queue.getJobs(types, start, end, asc);
  }

  async getNextJob(): Promise<Job> {
    throw new Error('Not supported');
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
    return this.queue.getJobLogs(jobId, start, end);
  }

  /**
   * Returns a promise that resolves with the job counts for the given queue.
   */
  getJobCounts(...types: string[]): Promise<{ [index: string]: number }> {
    return this.queue.getJobCounts(...types);
  }

  /**
   * Returns a promise that resolves with the job counts for the given queue of the given types.
   */
  async getJobCountByTypes(...types: string[]): Promise<number> {
    return this.queue.getJobCountByTypes(...types);
  }

  /**
   * Returns a promise that resolves with the quantity of completed jobs.
   */
  getCompletedCount(): Promise<number> {
    return this.queue.getCompletedCount();
  }

  /**
   * Returns a promise that resolves with the quantity of failed jobs.
   */
  getFailedCount(): Promise<number> {
    return this.queue.getFailedCount();
  }

  /**
   * Returns a promise that resolves with the quantity of delayed jobs.
   */
  getDelayedCount(): Promise<number> {
    return this.queue.getDelayedCount();
  }

  /**
   * Returns a promise that resolves with the quantity of waiting jobs.
   */
  getWaitingCount(): Promise<number> {
    return this.queue.getWaitingCount();
  }

  /**
   * Returns a promise that resolves with the quantity of paused jobs.
   */
  getPausedCount(): Promise<number> {
    return this.queue.getJobCountByTypes('paused');
  }

  /**
   * Returns a promise that resolves with the quantity of active jobs.
   */
  getActiveCount(): Promise<number> {
    return this.queue.getActiveCount();
  }

  /**
   * Returns a promise that resolves to the quantity of repeatable jobs.
   */
  async getRepeatableCount(): Promise<number> {
    const repeat = await this.queue.repeat;
    return repeat.getRepeatableCount();
  }

  /**
   * Tells the queue remove all jobs created outside of a grace period in milliseconds.
   * You can clean the jobs with the following states: completed, wait (typo for waiting), active, delayed, and failed.
   * @param grace Grace period in milliseconds.
   * @param limit Maximum amount of jobs to clean per call. If not provided will clean all matching jobs.
   * @param type Status of the job to clean. Values are completed, wait,
   * active, paused, delayed, and failed. Defaults to completed.
   */
  clean(
    grace: number,
    limit: number,
    type:
      | 'completed'
      | 'wait'
      | 'active'
      | 'paused'
      | 'delayed'
      | 'failed' = 'completed',
  ): Promise<Array<Job>> {
    return this.queue.clean(grace, limit, type);
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
    return this.attachListener(false, event, listener);
  }

  once(event: string | symbol, listener: (...args: any[]) => void): this {
    return this.attachListener(true, event, listener);
  }

  off(event: string | symbol, listener: (...args: any[]) => void): this {
    return this.detachListener(event, listener);
  }

  removeListener(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this {
    if (!listener) {
      throw new Error('listener is required');
    }
    return this.detachListener(event, listener);
  }

  removeAllListeners(event: string | symbol): this {
    return this.detachListener(event);
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
    return this.queue.getWorkers();
  }

  /**
   * Returns Queue name in base64 encoded format
   */
  base64Name(): string {
    return (this.queue as any).base64Name();
  }

  /**
   * Returns Queue name with keyPrefix (default: 'bull')
   */
  clientName(): string {
    return (this.queue as any).clientName();
  }

  /**
   * Returns Redis clients array which belongs to current Queue from string with all redis clients
   *
   * @param list String with all redis clients
   */
  parseClientList(list: string): { [key: string]: string }[] {
    return (this.queue as any).parseClientList(list);
  }

  retryJob(job: Job): Promise<void> {
    return job.retry();
  }

  private getQueueEvents() {
    if (!this.queueEvents) {
      this.queueEvents = new QueueEvents(this.name, this.opts);
    }
    return this.queueEvents;
  }

  private ensureWorkerCreated() {
    if (!this.worker) {
      throw new Error(
        'You should create internal ' +
          'worker by calling progress() ' +
          'prior to attach listeners to worker events',
      );
    }
  }

  private attachListener(
    once: boolean,
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this {
    switch (event) {
      case 'active':
        this.ensureWorkerCreated();
        if (once) {
          this.worker.once('active', listener);
        } else {
          this.worker.on('active', listener);
        }
        break;
      case 'completed':
        this.ensureWorkerCreated();
        if (once) {
          this.worker.once('completed', listener);
        } else {
          this.worker.on('completed', listener);
        }
        break;
      case 'drained':
        this.ensureWorkerCreated();
        if (once) {
          this.worker.once('drained', listener);
        } else {
          this.worker.on('drained', listener);
        }
        break;
      case 'failed':
        this.ensureWorkerCreated();
        if (once) {
          this.worker.once('failed', listener);
        } else {
          this.worker.on('failed', listener);
        }
        break;
      case 'paused':
        if (once) {
          this.queue.once('paused', listener);
        } else {
          this.queue.on('paused', listener);
        }
        break;
      case 'resumed':
        if (once) {
          this.queue.once('resumed', listener);
        } else {
          this.queue.on('resumed', listener);
        }
        break;
      case 'progress':
        if (once) {
          this.queue.once('progress', listener);
        } else {
          this.queue.on('progress', listener);
        }
        break;
      case 'waiting':
        if (once) {
          this.queue.once('waiting', listener);
        } else {
          this.queue.on('waiting', listener);
        }
        break;
      case 'global:active':
        if (once) {
          this.getQueueEvents().once('active', listener);
        } else {
          this.getQueueEvents().on('active', listener);
        }
        break;
      case 'global:completed':
        if (once) {
          this.getQueueEvents().once('completed', listener);
        } else {
          this.getQueueEvents().on('completed', listener);
        }
        break;
      case 'global:drained':
        if (once) {
          this.getQueueEvents().once('drained', listener);
        } else {
          this.getQueueEvents().on('drained', listener);
        }
        break;
      case 'global:failed':
        if (once) {
          this.getQueueEvents().once('failed', listener);
        } else {
          this.getQueueEvents().on('failed', listener);
        }
        break;
      case 'global:paused':
        if (once) {
          this.getQueueEvents().once('paused', listener);
        } else {
          this.getQueueEvents().on('paused', listener);
        }
        break;
      case 'global:resumed':
        if (once) {
          this.getQueueEvents().once('resumed', listener);
        } else {
          this.getQueueEvents().on('resumed', listener);
        }
        break;
      case 'global:progress':
        if (once) {
          this.getQueueEvents().once('progress', listener);
        } else {
          this.getQueueEvents().on('progress', listener);
        }
        break;
      case 'global:waiting':
        if (once) {
          this.getQueueEvents().once('waiting', listener);
        } else {
          this.getQueueEvents().on('waiting', listener);
        }
        break;
      default:
        throw new Error(
          `Listening on '${String(event)}' event is not supported`,
        );
    }
    return this;
  }

  detachListener(
    event: string | symbol,
    listener?: (...args: any[]) => void,
  ): this {
    switch (event) {
      case 'active':
        if (this.worker) {
          if (listener) {
            this.worker.removeListener('active', listener);
          } else {
            this.worker.removeAllListeners('active');
          }
        }
        break;
      case 'completed':
        if (this.worker) {
          if (listener) {
            this.worker.removeListener('completed', listener);
          } else {
            this.worker.removeAllListeners('completed');
          }
        }
        break;
      case 'drained':
        if (this.worker) {
          if (listener) {
            this.worker.removeListener('drained', listener);
          } else {
            this.worker.removeAllListeners('drained');
          }
        }
        break;
      case 'failed':
        if (this.worker) {
          if (listener) {
            this.worker.removeListener('failed', listener);
          } else {
            this.worker.removeAllListeners('failed');
          }
        }
        break;
      case 'paused':
        if (listener) {
          this.queue.removeListener('paused', listener);
        } else {
          this.queue.removeAllListeners('paused');
        }
        break;
      case 'resumed':
        if (listener) {
          this.queue.removeListener('resumed', listener);
        } else {
          this.queue.removeAllListeners('resumed');
        }
        break;
      case 'progress':
        if (listener) {
          this.queue.removeListener('progress', listener);
        } else {
          this.queue.removeAllListeners('progress');
        }
        break;
      case 'waiting':
        if (listener) {
          this.queue.removeListener('waiting', listener);
        } else {
          this.queue.removeAllListeners('waiting');
        }
        break;
      case 'global:active':
        if (this.queueEvents) {
          if (listener) {
            this.queueEvents.removeListener('active', listener);
          } else {
            this.queueEvents.removeAllListeners('active');
          }
        }
        break;
      case 'global:completed':
        if (this.queueEvents) {
          if (listener) {
            this.queueEvents.removeListener('completed', listener);
          } else {
            this.queueEvents.removeAllListeners('completed');
          }
        }
        break;
      case 'global:drained':
        if (this.queueEvents) {
          if (listener) {
            this.queueEvents.removeListener('drained', listener);
          } else {
            this.queueEvents.removeAllListeners('drained');
          }
        }
        break;
      case 'global:failed':
        if (this.queueEvents) {
          if (listener) {
            this.queueEvents.removeListener('failed', listener);
          } else {
            this.queueEvents.removeAllListeners('failed');
          }
        }
        break;
      case 'global:paused':
        if (this.queueEvents) {
          if (listener) {
            this.queueEvents.removeListener('paused', listener);
          } else {
            this.queueEvents.removeAllListeners('paused');
          }
        }
        break;
      case 'global:resumed':
        if (this.queueEvents) {
          if (listener) {
            this.queueEvents.removeListener('resumed', listener);
          } else {
            this.queueEvents.removeAllListeners('resumed');
          }
        }
        break;
      case 'global:waiting':
        if (this.queueEvents) {
          if (listener) {
            this.queueEvents.removeListener('waiting', listener);
          } else {
            this.queueEvents.removeAllListeners('waiting');
          }
        }
        break;
      default:
        break;
    }
    return this;
  }
}

export type JobStatusClean3 =
  | 'completed'
  | 'wait'
  | 'active'
  | 'delayed'
  | 'paused'
  | 'failed';

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
