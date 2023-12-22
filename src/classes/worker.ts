import * as fs from 'fs';
import { URL } from 'url';
import { Redis } from 'ioredis';
import * as path from 'path';
import { v4 } from 'uuid';

// Note: this Polyfill is only needed for Node versions < 15.4.0
import { AbortController } from 'node-abort-controller';

import {
  GetNextJobOptions,
  IoredisListener,
  JobJsonRaw,
  Processor,
  RedisClient,
  WorkerOptions,
} from '../interfaces';
import { MinimalQueue } from '../types';
import {
  delay,
  DELAY_TIME_1,
  isNotConnectionError,
  isRedisInstance,
  WORKER_SUFFIX,
} from '../utils';
import { QueueBase } from './queue-base';
import { Repeat } from './repeat';
import { ChildPool } from './child-pool';
import { Job } from './job';
import { RedisConnection } from './redis-connection';
import sandbox from './sandbox';
import { AsyncFifoQueue } from './async-fifo-queue';
import {
  DelayedError,
  RateLimitError,
  RATE_LIMIT_ERROR,
  WaitingChildrenError,
} from './errors';

// 10 seconds is the maximum time a BRPOPLPUSH can block.
const maximumBlockTimeout = 10;

// note: sandboxed processors would also like to define concurrency per process
// for better resource utilization.

export interface WorkerListener<
  DataType = any,
  ResultType = any,
  NameType extends string = string,
> extends IoredisListener {
  /**
   * Listen to 'active' event.
   *
   * This event is triggered when a job enters the 'active' state.
   */
  active: (job: Job<DataType, ResultType, NameType>, prev: string) => void;

  /**
   * Listen to 'closing' event.
   *
   * This event is triggered when the worker is closed.
   */
  closed: () => void;

  /**
   * Listen to 'closing' event.
   *
   * This event is triggered when the worker is closing.
   */
  closing: (msg: string) => void;

  /**
   * Listen to 'completed' event.
   *
   * This event is triggered when a job has successfully completed.
   */
  completed: (
    job: Job<DataType, ResultType, NameType>,
    result: ResultType,
    prev: string,
  ) => void;

  /**
   * Listen to 'drained' event.
   *
   * This event is triggered when the queue has drained the waiting list.
   * Note that there could still be delayed jobs waiting their timers to expire
   * and this event will still be triggered as long as the waiting list has emptied.
   */
  drained: () => void;

  /**
   * Listen to 'error' event.
   *
   * This event is triggered when an error is throw.
   */
  error: (failedReason: Error) => void;

  /**
   * Listen to 'failed' event.
   *
   * This event is triggered when a job has thrown an exception.
   * Note: job parameter could be received as undefined when an stalled job
   * reaches the stalled limit and it is deleted by the removeOnFail option.
   */
  failed: (
    job: Job<DataType, ResultType, NameType> | undefined,
    error: Error,
    prev: string,
  ) => void;

  /**
   * Listen to 'paused' event.
   *
   * This event is triggered when the queue is paused.
   */
  paused: () => void;

  /**
   * Listen to 'progress' event.
   *
   * This event is triggered when a job updates it progress, i.e. the
   * Job##updateProgress() method is called. This is useful to notify
   * progress or any other data from within a processor to the rest of the
   * world.
   */
  progress: (
    job: Job<DataType, ResultType, NameType>,
    progress: number | object,
  ) => void;

  /**
   * Listen to 'ready' event.
   *
   * This event is triggered when blockingConnection is ready.
   */
  ready: () => void;

  /**
   * Listen to 'resumed' event.
   *
   * This event is triggered when the queue is resumed.
   */
  resumed: () => void;

  /**
   * Listen to 'stalled' event.
   *
   * This event is triggered when a job has stalled and
   * has been moved back to the wait list.
   */
  stalled: (jobId: string, prev: string) => void;
}

/**
 *
 * This class represents a worker that is able to process jobs from the queue.
 * As soon as the class is instantiated and a connection to Redis is established
 * it will start processing jobs.
 *
 */
export class Worker<
  DataType = any,
  ResultType = any,
  NameType extends string = string,
> extends QueueBase {
  readonly opts: WorkerOptions;
  readonly id: string;

  private abortDelayController: AbortController | null = null;
  private asyncFifoQueue: AsyncFifoQueue<void | Job<
    DataType,
    ResultType,
    NameType
  >>;
  private blockingConnection: RedisConnection;
  private blockUntil = 0;
  private childPool: ChildPool;
  private drained: boolean = false;
  private extendLocksTimer: NodeJS.Timeout | null = null;
  private limitUntil = 0;
  private resumeWorker: () => void;
  private stalledCheckTimer: NodeJS.Timeout;
  private waiting: Promise<number> | null = null;
  private _repeat: Repeat;

  protected paused: Promise<void>;
  protected processFn: Processor<DataType, ResultType, NameType>;
  protected running = false;

  static RateLimitError(): Error {
    return new RateLimitError();
  }

  constructor(
    name: string,
    processor?: string | URL | null | Processor<DataType, ResultType, NameType>,
    opts?: WorkerOptions,
    Connection?: typeof RedisConnection,
  ) {
    super(
      name,
      {
        ...opts,
        blockingConnection: true,
      },
      Connection,
    );

    if (!opts || !opts.connection) {
      throw new Error('Worker requires a connection');
    }

    this.opts = {
      drainDelay: 5,
      concurrency: 1,
      lockDuration: 30000,
      maxStalledCount: 1,
      stalledInterval: 30000,
      autorun: true,
      runRetryDelay: 15000,
      ...this.opts,
    };

    if (this.opts.stalledInterval <= 0) {
      throw new Error('stalledInterval must be greater than 0');
    }

    this.concurrency = this.opts.concurrency;

    this.opts.lockRenewTime =
      this.opts.lockRenewTime || this.opts.lockDuration / 2;

    this.id = v4();

    if (processor) {
      if (typeof processor === 'function') {
        this.processFn = processor;
      } else {
        // SANDBOXED
        if (processor instanceof URL) {
          if (!fs.existsSync(processor)) {
            throw new Error(
              `URL ${processor} does not exist in the local file system`,
            );
          }
          processor = processor.href;
        } else {
          const supportedFileTypes = ['.js', '.ts', '.flow', '.cjs'];
          const processorFile =
            processor +
            (supportedFileTypes.includes(path.extname(processor)) ? '' : '.js');

          if (!fs.existsSync(processorFile)) {
            throw new Error(`File ${processorFile} does not exist`);
          }
        }

        const mainFile = this.opts.useWorkerThreads
          ? 'main-worker.js'
          : 'main.js';
        let mainFilePath = path.join(
          path.dirname(module.filename),
          `${mainFile}`,
        );
        try {
          fs.statSync(mainFilePath); // would throw if file not exists
        } catch (_) {
          mainFilePath = path.join(
            process.cwd(),
            `dist/cjs/classes/${mainFile}`,
          );
          fs.statSync(mainFilePath);
        }

        this.childPool = new ChildPool({
          mainFile: mainFilePath,
          useWorkerThreads: this.opts.useWorkerThreads,
        });

        this.processFn = sandbox<DataType, ResultType, NameType>(
          processor,
          this.childPool,
        ).bind(this);
      }

      if (this.opts.autorun) {
        this.run().catch(error => this.emit('error', error));
      }
    }

    const connectionName = this.clientName(WORKER_SUFFIX);
    this.blockingConnection = new RedisConnection(
      isRedisInstance(opts.connection)
        ? (<Redis>opts.connection).duplicate({ connectionName })
        : { ...opts.connection, connectionName },
      false,
      true,
      opts.skipVersionCheck,
    );
    this.blockingConnection.on('error', error => this.emit('error', error));
    this.blockingConnection.on('ready', () =>
      setTimeout(() => this.emit('ready'), 0),
    );
  }

  emit<U extends keyof WorkerListener<DataType, ResultType, NameType>>(
    event: U,
    ...args: Parameters<WorkerListener<DataType, ResultType, NameType>[U]>
  ): boolean {
    return super.emit(event, ...args);
  }

  off<U extends keyof WorkerListener<DataType, ResultType, NameType>>(
    eventName: U,
    listener: WorkerListener<DataType, ResultType, NameType>[U],
  ): this {
    super.off(eventName, listener);
    return this;
  }

  on<U extends keyof WorkerListener<DataType, ResultType, NameType>>(
    event: U,
    listener: WorkerListener<DataType, ResultType, NameType>[U],
  ): this {
    super.on(event, listener);
    return this;
  }

  once<U extends keyof WorkerListener<DataType, ResultType, NameType>>(
    event: U,
    listener: WorkerListener<DataType, ResultType, NameType>[U],
  ): this {
    super.once(event, listener);
    return this;
  }

  protected callProcessJob(
    job: Job<DataType, ResultType, NameType>,
    token: string,
  ): Promise<ResultType> {
    return this.processFn(job, token);
  }

  protected createJob(
    data: JobJsonRaw,
    jobId: string,
  ): Job<DataType, ResultType, NameType> {
    return this.Job.fromJSON(this as MinimalQueue, data, jobId) as Job<
      DataType,
      ResultType,
      NameType
    >;
  }

  /**
   *
   * Waits until the worker is ready to start processing jobs.
   * In general only useful when writing tests.
   *
   */
  async waitUntilReady(): Promise<RedisClient> {
    await super.waitUntilReady();
    return this.blockingConnection.client;
  }

  set concurrency(concurrency: number) {
    if (
      typeof concurrency !== 'number' ||
      concurrency < 1 ||
      !isFinite(concurrency)
    ) {
      throw new Error('concurrency must be a finite number greater than 0');
    }
    this.opts.concurrency = concurrency;
  }

  get repeat(): Promise<Repeat> {
    return new Promise<Repeat>(async resolve => {
      if (!this._repeat) {
        const connection = await this.client;
        this._repeat = new Repeat(this.name, {
          ...this.opts,
          connection,
        });
        this._repeat.on('error', e => this.emit.bind(this, e));
      }
      resolve(this._repeat);
    });
  }

  async run() {
    if (!this.processFn) {
      throw new Error('No process function is defined.');
    }

    if (this.running) {
      throw new Error('Worker is already running.');
    }

    try {
      this.running = true;

      if (this.closing) {
        return;
      }

      await this.startStalledCheckTimer();

      const jobsInProgress = new Set<{ job: Job; ts: number }>();
      this.startLockExtenderTimer(jobsInProgress);

      const asyncFifoQueue = (this.asyncFifoQueue =
        new AsyncFifoQueue<void | Job<DataType, ResultType, NameType>>());

      let tokenPostfix = 0;

      const client = await this.client;
      const bclient = await this.blockingConnection.client;

      while (!this.closing) {
        let numTotal = asyncFifoQueue.numTotal();
        while (
          !this.waiting &&
          numTotal < this.opts.concurrency &&
          (!this.limitUntil || numTotal == 0)
        ) {
          const token = `${this.id}:${tokenPostfix++}`;

          const fetchedJob = this.retryIfFailed<void | Job<
            DataType,
            ResultType,
            NameType
          >>(
            () => this._getNextJob(client, bclient, token, { block: true }),
            this.opts.runRetryDelay,
          );
          asyncFifoQueue.add(fetchedJob);

          numTotal = asyncFifoQueue.numTotal();

          if (this.waiting && numTotal > 1) {
            // We are waiting for jobs but we have others that we could start processing already
            break;
          }

          // We await here so that we fetch jobs in sequence, this is important to avoid unnecessary calls
          // to Redis in high concurrency scenarios.
          const job = await fetchedJob;

          // No more jobs waiting but we have others that could start processing already
          if (!job && numTotal > 1) {
            break;
          }

          // If there are potential jobs to be processed and blockUntil is set, we should exit to avoid waiting
          // for processing this job.
          if (this.blockUntil) {
            break;
          }
        }

        // Since there can be undefined jobs in the queue (when a job fails or queue is empty)
        // we iterate until we find a job.
        let job: Job<DataType, ResultType, NameType> | void;
        do {
          job = await asyncFifoQueue.fetch();
        } while (!job && asyncFifoQueue.numQueued() > 0);

        if (job) {
          const token = job.token;
          asyncFifoQueue.add(
            this.retryIfFailed<void | Job<DataType, ResultType, NameType>>(
              () =>
                this.processJob(
                  <Job<DataType, ResultType, NameType>>job,
                  token,
                  () => asyncFifoQueue.numTotal() <= this.opts.concurrency,
                  jobsInProgress,
                ),
              this.opts.runRetryDelay,
            ),
          );
        }
      }

      this.running = false;
      return asyncFifoQueue.waitAll();
    } catch (error) {
      this.running = false;
      throw error;
    }
  }

  /**
   * Returns a promise that resolves to the next job in queue.
   * @param token - worker token to be assigned to retrieved job
   * @returns a Job or undefined if no job was available in the queue.
   */
  async getNextJob(token: string, { block = true }: GetNextJobOptions = {}) {
    return this._getNextJob(
      await this.client,
      await this.blockingConnection.client,
      token,
      { block },
    );
  }

  private async _getNextJob(
    client: RedisClient,
    bclient: RedisClient,
    token: string,
    { block = true }: GetNextJobOptions = {},
  ): Promise<Job<DataType, ResultType, NameType> | undefined> {
    if (this.paused) {
      if (block) {
        await this.paused;
      } else {
        return;
      }
    }

    if (this.closing) {
      return;
    }

    if (this.drained && block && !this.limitUntil && !this.waiting) {
      this.waiting = this.waitForJob(bclient, this.blockUntil);
      try {
        this.blockUntil = await this.waiting;

        if (this.blockUntil <= 0 || this.blockUntil - Date.now() < 10) {
          return this.moveToActive(client, token);
        }
      } catch (err) {
        // Swallow error if locally paused or closing since we did force a disconnection
        if (
          !(this.paused || this.closing) &&
          isNotConnectionError(<Error>err)
        ) {
          throw err;
        }
      } finally {
        this.waiting = null;
      }
    } else {
      if (this.limitUntil) {
        this.abortDelayController?.abort();
        this.abortDelayController = new AbortController();
        await this.delay(this.limitUntil, this.abortDelayController);
      }
      return this.moveToActive(client, token);
    }
  }

  /**
   * Overrides the rate limit to be active for the next jobs.
   *
   * @param expireTimeMs - expire time in ms of this rate limit.
   */
  async rateLimit(expireTimeMs: number): Promise<void> {
    await this.client.then(client =>
      client.set(
        this.keys.limiter,
        Number.MAX_SAFE_INTEGER,
        'PX',
        expireTimeMs,
      ),
    );
  }

  protected async moveToActive(
    client: RedisClient,
    token: string,
  ): Promise<Job<DataType, ResultType, NameType>> {
    const [jobData, id, limitUntil, delayUntil] =
      await this.scripts.moveToActive(client, token);
    this.updateDelays(limitUntil, delayUntil);

    return this.nextJobFromJobData(jobData, id, token);
  }

  private async waitForJob(
    bclient: RedisClient,
    blockUntil: number,
  ): Promise<number> {
    if (this.paused) {
      return Infinity;
    }

    try {
      const opts: WorkerOptions = <WorkerOptions>this.opts;

      if (!this.closing) {
        let blockTimeout = Math.max(
          blockUntil ? (blockUntil - Date.now()) / 1000 : opts.drainDelay,
          0,
        );

        // Blocking for less than 50ms is useless.
        if (blockTimeout > 0.05) {
          blockTimeout = this.blockingConnection.capabilities.canDoubleTimeout
            ? blockTimeout
            : Math.ceil(blockTimeout);

          // We restrict the maximum block timeout to 10 second to avoid
          // blocking the connection for too long in the case of reconnections
          // reference: https://github.com/taskforcesh/bullmq/issues/1658
          blockTimeout = Math.min(blockTimeout, maximumBlockTimeout);

          // Markers should only be used for un-blocking, so we will handle them in this
          // function only.
          const result = await bclient.bzpopmin(this.keys.marker, blockTimeout);

          if (result) {
            const [_key, member, score] = result;

            if (member) {
              return parseInt(score);
            }
          }
        }
        return 0;
      }
    } catch (error) {
      if (isNotConnectionError(<Error>error)) {
        this.emit('error', <Error>error);
      }
      if (!this.closing) {
        await this.delay();
      }
    } finally {
      this.waiting = null;
    }
    return Infinity;
  }

  /**
   *
   * This function is exposed only for testing purposes.
   */
  async delay(
    milliseconds?: number,
    abortController?: AbortController,
  ): Promise<void> {
    await delay(milliseconds || DELAY_TIME_1, abortController);
  }

  private updateDelays(limitUntil = 0, delayUntil = 0) {
    this.limitUntil = Math.max(limitUntil, 0) || 0;
    this.blockUntil = Math.max(delayUntil, 0) || 0;
  }

  protected async nextJobFromJobData(
    jobData?: JobJsonRaw,
    jobId?: string,
    token?: string,
  ): Promise<Job<DataType, ResultType, NameType>> {
    if (!jobData) {
      if (!this.drained) {
        this.emit('drained');
        this.drained = true;
      }
    } else {
      this.drained = false;
      const job = this.createJob(jobData, jobId);
      job.token = token;
      if (job.opts.repeat) {
        const repeat = await this.repeat;
        await repeat.addNextRepeatableJob(job.name, job.data, job.opts);
      }
      return job;
    }
  }

  async processJob(
    job: Job<DataType, ResultType, NameType>,
    token: string,
    fetchNextCallback = () => true,
    jobsInProgress: Set<{ job: Job; ts: number }>,
  ): Promise<void | Job<DataType, ResultType, NameType>> {
    if (!job || this.closing || this.paused) {
      return;
    }

    const handleCompleted = async (result: ResultType) => {
      if (!this.connection.closing) {
        const completed = await job.moveToCompleted(
          result,
          token,
          fetchNextCallback() && !(this.closing || this.paused),
        );
        this.emit('completed', job, result, 'active');
        const [jobData, jobId, limitUntil, delayUntil] = completed || [];
        this.updateDelays(limitUntil, delayUntil);

        return this.nextJobFromJobData(jobData, jobId, token);
      }
    };

    const handleFailed = async (err: Error) => {
      if (!this.connection.closing) {
        try {
          if (err.message == RATE_LIMIT_ERROR) {
            this.limitUntil = await this.moveLimitedBackToWait(job, token);
            return;
          }

          if (
            err instanceof DelayedError ||
            err.message == 'DelayedError' ||
            err instanceof WaitingChildrenError ||
            err.name == 'WaitingChildrenError'
          ) {
            return;
          }

          await job.moveToFailed(err, token);
          this.emit('failed', job, err, 'active');
        } catch (err) {
          this.emit('error', <Error>err);
          // It probably means that the job has lost the lock before completion
          // A worker will (or already has) moved the job back
          // to the waiting list (as stalled)
        }
      }
    };

    this.emit('active', job, 'waiting');

    const inProgressItem = { job, ts: Date.now() };

    try {
      jobsInProgress.add(inProgressItem);
      const result = await this.callProcessJob(job, token);
      return await handleCompleted(result);
    } catch (err) {
      return handleFailed(<Error>err);
    } finally {
      jobsInProgress.delete(inProgressItem);
    }
  }

  /**
   *
   * Pauses the processing of this queue only for this worker.
   */
  async pause(doNotWaitActive?: boolean): Promise<void> {
    if (!this.paused) {
      this.paused = new Promise(resolve => {
        this.resumeWorker = function () {
          resolve();
          this.paused = null; // Allow pause to be checked externally for paused state.
          this.resumeWorker = null;
        };
      });
      await (!doNotWaitActive && this.whenCurrentJobsFinished());
      this.emit('paused');
    }
  }

  /**
   *
   * Resumes processing of this worker (if paused).
   */
  resume(): void {
    if (this.resumeWorker) {
      this.resumeWorker();
      this.emit('resumed');
    }
  }

  /**
   *
   * Checks if worker is paused.
   *
   * @returns true if worker is paused, false otherwise.
   */
  isPaused(): boolean {
    return !!this.paused;
  }

  /**
   *
   * Checks if worker is currently running.
   *
   * @returns true if worker is running, false otherwise.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   *
   * Closes the worker and related redis connections.
   *
   * This method waits for current jobs to finalize before returning.
   *
   * @param force - Use force boolean parameter if you do not want to wait for
   * current jobs to be processed.
   *
   * @returns Promise that resolves when the worker has been closed.
   */
  close(force = false): Promise<void> {
    if (this.closing) {
      return this.closing;
    }
    this.closing = (async () => {
      this.emit('closing', 'closing queue');

      this.abortDelayController?.abort();

      const client =
        this.blockingConnection.status == 'ready'
          ? await this.blockingConnection.client
          : null;

      this.resume();
      await Promise.resolve()
        .finally(() => {
          return force || this.whenCurrentJobsFinished(false);
        })
        .finally(() => {
          const closePoolPromise = this.childPool?.clean();

          if (force) {
            // since we're not waiting for the job to end attach
            // an error handler to avoid crashing the whole process
            closePoolPromise?.catch(err => {
              console.error(err); // TODO: emit error in next breaking change version
            });
            return;
          }
          return closePoolPromise;
        })
        .finally(() => clearTimeout(this.extendLocksTimer))
        .finally(() => clearTimeout(this.stalledCheckTimer))
        .finally(() => client && client.disconnect())
        .finally(() => this.connection.close())
        .finally(() => this.emit('closed'));
      this.closed = true;
    })();
    return this.closing;
  }

  /**
   *
   * Manually starts the stalled checker.
   * The check will run once as soon as this method is called, and
   * then every opts.stalledInterval milliseconds until the worker is closed.
   * Note: Normally you do not need to call this method, since the stalled checker
   * is automatically started when the worker starts processing jobs after
   * calling run. However if you want to process the jobs manually you need
   * to call this method to start the stalled checker.
   *
   * @see {@link https://docs.bullmq.io/patterns/manually-fetching-jobs}
   */
  async startStalledCheckTimer(): Promise<void> {
    if (!this.opts.skipStalledCheck) {
      clearTimeout(this.stalledCheckTimer);

      if (!this.closing) {
        try {
          await this.checkConnectionError(() => this.moveStalledJobsToWait());
          this.stalledCheckTimer = setTimeout(async () => {
            await this.startStalledCheckTimer();
          }, this.opts.stalledInterval);
        } catch (err) {
          this.emit('error', <Error>err);
        }
      }
    }
  }

  private startLockExtenderTimer(
    jobsInProgress: Set<{ job: Job; ts: number }>,
  ): void {
    if (!this.opts.skipLockRenewal) {
      clearTimeout(this.extendLocksTimer);

      if (!this.closed) {
        this.extendLocksTimer = setTimeout(async () => {
          // Get all the jobs whose locks expire in less than 1/2 of the lockRenewTime
          const now = Date.now();
          const jobsToExtend = [];

          for (const item of jobsInProgress) {
            const { job, ts } = item;
            if (!ts) {
              item.ts = now;
              continue;
            }

            if (ts + this.opts.lockRenewTime / 2 < now) {
              item.ts = now;
              jobsToExtend.push(job);
            }
          }

          try {
            if (jobsToExtend.length) {
              await this.extendLocks(jobsToExtend);
            }
          } catch (err) {
            this.emit('error', <Error>err);
          }

          this.startLockExtenderTimer(jobsInProgress);
        }, this.opts.lockRenewTime / 2);
      }
    }
  }

  /**
   * Returns a promise that resolves when active jobs are cleared
   *
   * @returns
   */
  private async whenCurrentJobsFinished(reconnect = true) {
    //
    // Force reconnection of blocking connection to abort blocking redis call immediately.
    //
    if (this.waiting) {
      // If we are not going to reconnect, we will not wait for the disconnection.
      await this.blockingConnection.disconnect(reconnect);
    } else {
      reconnect = false;
    }

    if (this.asyncFifoQueue) {
      await this.asyncFifoQueue.waitAll();
    }

    reconnect && (await this.blockingConnection.reconnect());
  }

  private async retryIfFailed<T>(fn: () => Promise<T>, delayInMs: number) {
    const retry = 1;
    do {
      try {
        return await fn();
      } catch (err) {
        this.emit('error', <Error>err);
        if (delayInMs) {
          await this.delay(delayInMs);
        } else {
          return;
        }
      }
    } while (retry);
  }

  protected async extendLocks(jobs: Job[]) {
    try {
      const multi = (await this.client).multi();
      for (const job of jobs) {
        await this.scripts.extendLock(
          job.id,
          job.token,
          this.opts.lockDuration,
          multi,
        );
      }
      const result = (await multi.exec()) as [Error, string][];

      for (const [err, jobId] of result) {
        if (err) {
          // TODO: signal process function that the job has been lost.
          this.emit(
            'error',
            new Error(`could not renew lock for job ${jobId}`),
          );
        }
      }
    } catch (err) {
      this.emit('error', <Error>err);
    }
  }

  private async moveStalledJobsToWait() {
    const chunkSize = 50;
    const [failed, stalled] = await this.scripts.moveStalledJobsToWait();

    stalled.forEach((jobId: string) => this.emit('stalled', jobId, 'active'));

    const jobPromises: Promise<Job<DataType, ResultType, NameType>>[] = [];
    for (let i = 0; i < failed.length; i++) {
      jobPromises.push(
        Job.fromId<DataType, ResultType, NameType>(
          this as MinimalQueue,
          failed[i],
        ),
      );

      if ((i + 1) % chunkSize === 0) {
        this.notifyFailedJobs(await Promise.all(jobPromises));
        jobPromises.length = 0;
      }
    }

    this.notifyFailedJobs(await Promise.all(jobPromises));
  }

  private notifyFailedJobs(failedJobs: Job<DataType, ResultType, NameType>[]) {
    failedJobs.forEach((job: Job<DataType, ResultType, NameType>) =>
      this.emit(
        'failed',
        job,
        new Error('job stalled more than allowable limit'),
        'active',
      ),
    );
  }

  private moveLimitedBackToWait(
    job: Job<DataType, ResultType, NameType>,
    token: string,
  ) {
    return this.scripts.moveJobFromActiveToWait(job.id, token);
  }
}
