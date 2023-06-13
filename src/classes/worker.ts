import * as fs from 'fs';
import { Redis } from 'ioredis';
import * as path from 'path';
import { v4 } from 'uuid';
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
  isRedisVersionLowerThan,
  WORKER_SUFFIX,
} from '../utils';
import { QueueBase } from './queue-base';
import { Repeat } from './repeat';
import { ChildPool } from './child-pool';
import { Job } from './job';
import { RedisConnection } from './redis-connection';
import sandbox from './sandbox';
import { AsyncFifoQueue } from './async-fifo-queue';
import { DelayedError } from './delayed-error';
import { WaitingChildrenError } from './waiting-children-error';

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

const RATE_LIMIT_ERROR = 'bullmq:rateLimitExceeded';

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

  private drained: boolean = false;
  private waiting: Promise<string> | null = null;
  private running = false;
  private blockUntil = 0;
  private limitUntil = 0;

  protected processFn: Processor<DataType, ResultType, NameType>;

  private resumeWorker: () => void;
  protected paused: Promise<void>;
  private _repeat: Repeat;
  private childPool: ChildPool;

  private extendLocksTimer: NodeJS.Timeout | null = null;

  private blockingConnection: RedisConnection;

  private stalledCheckTimer: NodeJS.Timeout;

  private asyncFifoQueue: AsyncFifoQueue<void | Job<
    DataType,
    ResultType,
    NameType
  >>;

  static RateLimitError(): Error {
    return new Error(RATE_LIMIT_ERROR);
  }

  constructor(
    name: string,
    processor?: string | null | Processor<DataType, ResultType, NameType>,
    opts: WorkerOptions = {},
    Connection?: typeof RedisConnection,
  ) {
    super(
      name,
      {
        ...opts,
        sharedConnection: isRedisInstance(opts.connection),
        blockingConnection: true,
      },
      Connection,
    );

    if (this.opts.stalledInterval <= 0) {
      throw new Error('stalledInterval must be greater than 0');
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

    this.concurrency = this.opts.concurrency;

    this.opts.lockRenewTime =
      this.opts.lockRenewTime || this.opts.lockDuration / 2;

    this.id = v4();

    if (processor) {
      if (typeof processor === 'function') {
        this.processFn = processor;
      } else {
        // SANDBOXED
        const supportedFileTypes = ['.js', '.ts', '.flow', '.cjs'];
        const processorFile =
          processor +
          (supportedFileTypes.includes(path.extname(processor)) ? '' : '.js');

        if (!fs.existsSync(processorFile)) {
          throw new Error(`File ${processorFile} does not exist`);
        }

        const mainFile = this.opts.useWorkerThreads
          ? 'main-worker.js'
          : 'main.js';
        let mainFilePath = path.join(__dirname, `${mainFile}`);
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
    if (typeof concurrency !== 'number' || concurrency < 1) {
      throw new Error('concurrency must be a number greater than 0');
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

      while (!this.closing) {
        while (
          !this.waiting &&
          asyncFifoQueue.numTotal() < this.opts.concurrency &&
          (!this.limitUntil || asyncFifoQueue.numTotal() == 0)
        ) {
          const token = `${this.id}:${tokenPostfix++}`;
          asyncFifoQueue.add(
            this.retryIfFailed<void | Job<DataType, ResultType, NameType>>(
              () => this.getNextJob(token),
              this.opts.runRetryDelay,
            ),
          );
        }

        const job = await asyncFifoQueue.fetch();

        if (job) {
          const token = job.token;
          asyncFifoQueue.add(
            this.retryIfFailed<void | Job<DataType, ResultType, NameType>>(
              () =>
                this.processJob(
                  job,
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
  async getNextJob(
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
      try {
        this.waiting = this.waitForJob();
        try {
          const jobId = await this.waiting;
          return this.moveToActive(token, jobId);
        } finally {
          this.waiting = null;
        }
      } catch (err) {
        // Swallow error if locally paused or closing since we did force a disconnection
        if (
          !(this.paused || this.closing) &&
          isNotConnectionError(<Error>err)
        ) {
          throw err;
        }
      }
    } else {
      if (this.limitUntil) {
        // TODO: We need to be able to break this delay when we are closing the worker.
        await this.delay(this.limitUntil);
      }
      return this.moveToActive(token);
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
    token: string,
    jobId?: string,
  ): Promise<Job<DataType, ResultType, NameType>> {
    // If we get the special delayed job ID, we pick the delay as the next
    // block timeout.
    if (jobId && jobId.startsWith('0:')) {
      this.blockUntil = parseInt(jobId.split(':')[1]) || 0;
    }
    const [jobData, id, limitUntil, delayUntil] =
      await this.scripts.moveToActive(token, jobId);
    return this.nextJobFromJobData(jobData, id, limitUntil, delayUntil, token);
  }

  private async waitForJob() {
    // I am not sure returning here this quick is a good idea, the main
    // loop could stay looping at a very high speed and consume all CPU time.
    if (this.paused) {
      return;
    }

    try {
      const opts: WorkerOptions = <WorkerOptions>this.opts;

      if (!this.closing) {
        const client = await this.blockingConnection.client;

        let blockTimeout = Math.max(
          this.blockUntil
            ? (this.blockUntil - Date.now()) / 1000
            : opts.drainDelay,
          0.01,
        );

        // Only Redis v6.0.0 and above supports doubles as block time
        blockTimeout = isRedisVersionLowerThan(
          this.blockingConnection.redisVersion,
          '6.0.0',
        )
          ? Math.ceil(blockTimeout)
          : blockTimeout;

        // We restrict the maximum block timeout to 10 second to avoid
        // blocking the connection for too long in the case of reconnections
        // reference: https://github.com/taskforcesh/bullmq/issues/1658
        blockTimeout = Math.min(blockTimeout, maximumBlockTimeout);

        const jobId = await client.brpoplpush(
          this.keys.wait,
          this.keys.active,
          blockTimeout,
        );
        return jobId;
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
  }

  /**
   *
   * This function is exposed only for testing purposes.
   */
  async delay(milliseconds?: number): Promise<void> {
    await delay(milliseconds || DELAY_TIME_1);
  }

  protected async nextJobFromJobData(
    jobData?: JobJsonRaw,
    jobId?: string,
    limitUntil?: number,
    delayUntil?: number,
    token?: string,
  ): Promise<Job<DataType, ResultType, NameType>> {
    if (!jobData) {
      if (!this.drained) {
        this.emit('drained');
        this.drained = true;
        this.blockUntil = 0;
      }
    }

    this.limitUntil = Math.max(limitUntil, 0) || 0;
    if (delayUntil) {
      this.blockUntil = Math.max(delayUntil, 0) || 0;
    }

    if (jobData) {
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
        return this.nextJobFromJobData(
          jobData,
          jobId,
          limitUntil,
          delayUntil,
          token,
        );
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
            err.name == 'DelayedError' ||
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

      const client = await this.blockingConnection.client;

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
        .finally(() => client.disconnect())
        .finally(() => this.connection.close())
        .finally(() => this.emit('closed'));
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

      if (!this.closing) {
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
      await this.blockingConnection.disconnect();
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
