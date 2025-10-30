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
  MinimalQueue,
  RedisClient,
  Span,
  WorkerOptions,
} from '../interfaces';
import { JobProgress } from '../types';
import { Processor } from '../types/processor';
import {
  delay,
  DELAY_TIME_1,
  isNotConnectionError,
  isRedisInstance,
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
  WaitingError,
  UnrecoverableError,
} from './errors';
import { SpanKind, TelemetryAttributes } from '../enums';
import { JobScheduler } from './job-scheduler';

const ONE_SECOND = 1000;

// 10 seconds is the maximum time a BZPOPMIN can block.
const maximumBlockTimeout = 10;

// 30 seconds is the maximum limit until.
const maximumRateLimitDelay = 30000;

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
    progress: JobProgress,
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
  private blockingConnection: RedisConnection;
  private blockUntil = 0;
  private _concurrency: number;
  private childPool: ChildPool;
  private drained = false;
  private extendLocksTimer: NodeJS.Timeout | null = null;
  private limitUntil = 0;

  private stalledCheckStopper?: () => void;
  private waiting: Promise<number> | null = null;
  private _repeat: Repeat; // To be deprecated in v6 in favor of Job Scheduler

  protected _jobScheduler: JobScheduler;

  protected paused: boolean;
  protected processFn: Processor<DataType, ResultType, NameType>;
  protected running = false;
  protected mainLoopRunning: Promise<void> | null = null;

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
        drainDelay: 5,
        concurrency: 1,
        lockDuration: 30000,
        maxStalledCount: 1,
        stalledInterval: 30000,
        autorun: true,
        runRetryDelay: 15000,
        ...opts,
        blockingConnection: true,
      },
      Connection,
    );

    if (!opts || !opts.connection) {
      throw new Error('Worker requires a connection');
    }

    if (
      typeof this.opts.maxStalledCount !== 'number' ||
      this.opts.maxStalledCount < 0
    ) {
      throw new Error('maxStalledCount must be greater or equal than 0');
    }

    if (
      typeof this.opts.maxStartedAttempts === 'number' &&
      this.opts.maxStartedAttempts < 0
    ) {
      throw new Error('maxStartedAttempts must be greater or equal than 0');
    }

    if (
      typeof this.opts.stalledInterval !== 'number' ||
      this.opts.stalledInterval <= 0
    ) {
      throw new Error('stalledInterval must be greater than 0');
    }

    if (typeof this.opts.drainDelay !== 'number' || this.opts.drainDelay <= 0) {
      throw new Error('drainDelay must be greater than 0');
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
          const supportedFileTypes = ['.js', '.ts', '.flow', '.cjs', '.mjs'];
          const processorFile =
            processor +
            (supportedFileTypes.includes(path.extname(processor)) ? '' : '.js');

          if (!fs.existsSync(processorFile)) {
            throw new Error(`File ${processorFile} does not exist`);
          }
        }

        // Separate paths so that bundling tools can resolve dependencies easier
        const dirname = path.dirname(module.filename || __filename);
        const workerThreadsMainFile = path.join(dirname, 'main-worker.js');
        const spawnProcessMainFile = path.join(dirname, 'main.js');

        let mainFilePath = this.opts.useWorkerThreads
          ? workerThreadsMainFile
          : spawnProcessMainFile;

        try {
          fs.statSync(mainFilePath); // would throw if file not exists
        } catch (_) {
          const mainFile = this.opts.useWorkerThreads
            ? 'main-worker.js'
            : 'main.js';
          mainFilePath = path.join(
            process.cwd(),
            `dist/cjs/classes/${mainFile}`,
          );
          fs.statSync(mainFilePath);
        }

        this.childPool = new ChildPool({
          mainFile: mainFilePath,
          useWorkerThreads: this.opts.useWorkerThreads,
          workerForkOptions: this.opts.workerForkOptions,
          workerThreadsOptions: this.opts.workerThreadsOptions,
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

    const connectionName =
      this.clientName() + (this.opts.name ? `:w:${this.opts.name}` : '');
    this.blockingConnection = new RedisConnection(
      isRedisInstance(opts.connection)
        ? (<Redis>opts.connection).duplicate({ connectionName })
        : { ...opts.connection, connectionName },
      {
        shared: false,
        blocking: true,
        skipVersionCheck: opts.skipVersionCheck,
      },
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
    this._concurrency = concurrency;
  }

  get concurrency() {
    return this._concurrency;
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

  get jobScheduler(): Promise<JobScheduler> {
    return new Promise<JobScheduler>(async resolve => {
      if (!this._jobScheduler) {
        const connection = await this.client;
        this._jobScheduler = new JobScheduler(this.name, {
          ...this.opts,
          connection,
        });
        this._jobScheduler.on('error', e => this.emit.bind(this, e));
      }
      resolve(this._jobScheduler);
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

      if (this.closing || this.paused) {
        return;
      }

      await this.startStalledCheckTimer();

      const client = await this.client;
      const bclient = await this.blockingConnection.client;

      this.mainLoopRunning = this.mainLoop(client, bclient);

      // We must await here or finally will be called too early.
      await this.mainLoopRunning;
    } finally {
      this.running = false;
    }
  }

  private async waitForRateLimit(): Promise<void> {
    const limitUntil = this.limitUntil;
    if (limitUntil > Date.now()) {
      this.abortDelayController?.abort();
      this.abortDelayController = new AbortController();

      const delay = this.getRateLimitDelay(limitUntil - Date.now());

      await this.delay(delay, this.abortDelayController);
    }
  }

  /**
   * This is the main loop in BullMQ. Its goals are to fetch jobs from the queue
   * as efficiently as possible, providing concurrency and minimal unnecessary calls
   * to Redis.
   */
  private async mainLoop(client: RedisClient, bclient: RedisClient) {
    const asyncFifoQueue = new AsyncFifoQueue<void | Job<
      DataType,
      ResultType,
      NameType
    >>();
    const jobsInProgress = new Set<{ job: Job; ts: number }>();
    this.startLockExtenderTimer(jobsInProgress);

    let tokenPostfix = 0;

    while ((!this.closing && !this.paused) || asyncFifoQueue.numTotal() > 0) {
      /**
       * This inner loop tries to fetch jobs concurrently, but if we are waiting for a job
       * to arrive at the queue we should not try to fetch more jobs (as it would be pointless)
       */
      while (
        !this.closing &&
        !this.paused &&
        !this.waiting &&
        asyncFifoQueue.numTotal() < this._concurrency &&
        !this.isRateLimited()
      ) {
        const token = `${this.id}:${tokenPostfix++}`;

        const fetchedJob = this.retryIfFailed<void | Job<
          DataType,
          ResultType,
          NameType
        >>(() => this._getNextJob(client, bclient, token, { block: true }), {
          delayInMs: this.opts.runRetryDelay,
          onlyEmitError: true,
        });
        asyncFifoQueue.add(fetchedJob);

        if (this.waiting && asyncFifoQueue.numTotal() > 1) {
          // We are waiting for jobs but we have others that we could start processing already
          break;
        }

        // We await here so that we fetch jobs in sequence, this is important to avoid unnecessary calls
        // to Redis in high concurrency scenarios.
        const job = await fetchedJob;

        // No more jobs waiting but we have others that could start processing already
        if (!job && asyncFifoQueue.numTotal() > 1) {
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
          this.processJob(
            <Job<DataType, ResultType, NameType>>job,
            token,
            () => asyncFifoQueue.numTotal() <= this._concurrency,
            jobsInProgress,
          ),
        );
      } else if (asyncFifoQueue.numQueued() === 0) {
        await this.waitForRateLimit();
      }
    }
  }

  /**
   * Returns a promise that resolves to the next job in queue.
   * @param token - worker token to be assigned to retrieved job
   * @returns a Job or undefined if no job was available in the queue.
   */
  async getNextJob(token: string, { block = true }: GetNextJobOptions = {}) {
    const nextJob = await this._getNextJob(
      await this.client,
      await this.blockingConnection.client,
      token,
      { block },
    );

    return this.trace<Job<DataType, ResultType, NameType> | undefined>(
      SpanKind.INTERNAL,
      'getNextJob',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.WorkerId]: this.id,
          [TelemetryAttributes.QueueName]: this.name,
          [TelemetryAttributes.WorkerName]: this.opts.name,
          [TelemetryAttributes.WorkerOptions]: JSON.stringify({ block }),
          [TelemetryAttributes.JobId]: nextJob?.id,
        });

        return nextJob;
      },
      nextJob?.opts?.telemetry?.metadata,
    );
  }

  private async _getNextJob(
    client: RedisClient,
    bclient: RedisClient,
    token: string,
    { block = true }: GetNextJobOptions = {},
  ): Promise<Job<DataType, ResultType, NameType> | undefined> {
    if (this.paused) {
      return;
    }

    if (this.closing) {
      return;
    }

    if (this.drained && block && !this.limitUntil && !this.waiting) {
      this.waiting = this.waitForJob(bclient, this.blockUntil);
      try {
        this.blockUntil = await this.waiting;

        if (this.blockUntil <= 0 || this.blockUntil - Date.now() < 1) {
          return await this.moveToActive(client, token, this.opts.name);
        }
      } finally {
        this.waiting = null;
      }
    } else {
      if (!this.isRateLimited()) {
        return this.moveToActive(client, token, this.opts.name);
      }
    }
  }

  /**
   * Overrides the rate limit to be active for the next jobs.
   * @deprecated This method is deprecated and will be removed in v6. Use queue.rateLimit method instead.
   * @param expireTimeMs - expire time in ms of this rate limit.
   */
  async rateLimit(expireTimeMs: number): Promise<void> {
    await this.trace<void>(
      SpanKind.INTERNAL,
      'rateLimit',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.WorkerId]: this.id,
          [TelemetryAttributes.WorkerRateLimit]: expireTimeMs,
        });

        await this.client.then(client =>
          client.set(
            this.keys.limiter,
            Number.MAX_SAFE_INTEGER,
            'PX',
            expireTimeMs,
          ),
        );
      },
    );
  }

  get minimumBlockTimeout(): number {
    return this.blockingConnection.capabilities.canBlockFor1Ms
      ? /* 1 millisecond is chosen because the granularity of our timestamps are milliseconds.
Obviously we can still process much faster than 1 job per millisecond but delays and rate limits
will never work with more accuracy than 1ms. */
        0.001
      : 0.002;
  }

  private isRateLimited(): boolean {
    return this.limitUntil > Date.now();
  }

  protected async moveToActive(
    client: RedisClient,
    token: string,
    name?: string,
  ): Promise<Job<DataType, ResultType, NameType>> {
    const [jobData, id, rateLimitDelay, delayUntil] =
      await this.scripts.moveToActive(client, token, name);
    this.updateDelays(rateLimitDelay, delayUntil);

    return this.nextJobFromJobData(jobData, id, token);
  }

  private async waitForJob(
    bclient: RedisClient,
    blockUntil: number,
  ): Promise<number> {
    if (this.paused) {
      return Infinity;
    }

    let timeout: NodeJS.Timeout;
    try {
      if (!this.closing && !this.isRateLimited()) {
        let blockTimeout = this.getBlockTimeout(blockUntil);

        if (blockTimeout > 0) {
          blockTimeout = this.blockingConnection.capabilities.canDoubleTimeout
            ? blockTimeout
            : Math.ceil(blockTimeout);

          // We cannot trust that the blocking connection stays blocking forever
          // due to issues in Redis and IORedis, so we will reconnect if we
          // don't get a response in the expected time.
          timeout = setTimeout(
            async () => {
              bclient.disconnect(!this.closing);
            },
            blockTimeout * 1000 + 1000,
          );

          this.updateDelays(); // reset delays to avoid reusing same values in next iteration

          // Markers should only be used for un-blocking, so we will handle them in this
          // function only.
          const result = await bclient.bzpopmin(this.keys.marker, blockTimeout);
          if (result) {
            const [_key, member, score] = result;

            if (member) {
              const newBlockUntil = parseInt(score);
              // Use by pro version as rate limited groups could generate lower blockUntil values
              // markers only return delays for delayed jobs
              if (blockUntil && newBlockUntil > blockUntil) {
                return blockUntil;
              }
              return newBlockUntil;
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
      clearTimeout(timeout);
    }
    return Infinity;
  }

  protected getBlockTimeout(blockUntil: number): number {
    const opts: WorkerOptions = <WorkerOptions>this.opts;

    // when there are delayed jobs
    if (blockUntil) {
      const blockDelay = blockUntil - Date.now();
      // when we reach the time to get new jobs
      if (blockDelay <= 0) {
        return blockDelay;
      } else if (blockDelay < this.minimumBlockTimeout * 1000) {
        return this.minimumBlockTimeout;
      } else {
        // We restrict the maximum block timeout to 10 second to avoid
        // blocking the connection for too long in the case of reconnections
        // reference: https://github.com/taskforcesh/bullmq/issues/1658
        return Math.min(blockDelay / 1000, maximumBlockTimeout);
      }
    } else {
      return Math.max(opts.drainDelay, this.minimumBlockTimeout);
    }
  }

  protected getRateLimitDelay(delay: number): number {
    // We restrict the maximum limit until to 30 second to
    // be able to promote delayed jobs while queue is rate limited
    return Math.min(delay, maximumRateLimitDelay);
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

  private updateDelays(limitDelay = 0, delayUntil = 0) {
    const clampedLimit = Math.max(limitDelay, 0);
    if (clampedLimit > 0) {
      this.limitUntil = Date.now() + clampedLimit;
    } else {
      this.limitUntil = 0;
    }
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

      try {
        await this.retryIfFailed(
          async () => {
            if (job.repeatJobKey && job.repeatJobKey.split(':').length < 5) {
              const jobScheduler = await this.jobScheduler;
              await jobScheduler.upsertJobScheduler(
                // Most of these arguments are not really needed
                // anymore as we read them from the job scheduler itself
                job.repeatJobKey,
                job.opts.repeat,
                job.name,
                job.data,
                job.opts,
                { override: false, producerId: job.id },
              );
            } else if (job.opts.repeat) {
              const repeat = await this.repeat;
              await repeat.updateRepeatableJob(job.name, job.data, job.opts, {
                override: false,
              });
            }
          },
          { delayInMs: this.opts.runRetryDelay },
        );
      } catch (err) {
        // Emit error but don't throw to avoid breaking current job completion
        // Note: This means the next repeatable job will not be scheduled
        const errorMessage = err instanceof Error ? err.message : String(err);
        const schedulingError = new Error(
          `Failed to add repeatable job for next iteration: ${errorMessage}`,
        );
        this.emit('error', schedulingError);

        // Return undefined to indicate no next job is available
        return undefined;
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
    const srcPropagationMedatada = job.opts?.telemetry?.metadata;

    return this.trace<void | Job<DataType, ResultType, NameType>>(
      SpanKind.CONSUMER,
      'process',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.WorkerId]: this.id,
          [TelemetryAttributes.WorkerName]: this.opts.name,
          [TelemetryAttributes.JobId]: job.id,
          [TelemetryAttributes.JobName]: job.name,
          [TelemetryAttributes.JobAttemptsMade]: job.attemptsMade,
        });

        this.emit('active', job, 'waiting');

        const processedOn = Date.now();
        const inProgressItem = { job, ts: processedOn };

        try {
          const unrecoverableErrorMessage =
            this.getUnrecoverableErrorMessage(job);
          if (unrecoverableErrorMessage) {
            const failed = await this.retryIfFailed<void | Job<
              DataType,
              ResultType,
              NameType
            >>(
              () =>
                this.handleFailed(
                  new UnrecoverableError(unrecoverableErrorMessage),
                  job,
                  token,
                  fetchNextCallback,
                  jobsInProgress,
                  inProgressItem,
                  span,
                ),
              { delayInMs: this.opts.runRetryDelay, span },
            );
            return failed;
          }
          jobsInProgress.add(inProgressItem);

          const result = await this.callProcessJob(job, token);
          return await this.retryIfFailed<void | Job<
            DataType,
            ResultType,
            NameType
          >>(
            () =>
              this.handleCompleted(
                result,
                job,
                token,
                fetchNextCallback,
                jobsInProgress,
                inProgressItem,
                span,
              ),
            { delayInMs: this.opts.runRetryDelay, span },
          );
        } catch (err) {
          const failed = await this.retryIfFailed<void | Job<
            DataType,
            ResultType,
            NameType
          >>(
            () =>
              this.handleFailed(
                <Error>err,
                job,
                token,
                fetchNextCallback,
                jobsInProgress,
                inProgressItem,
                span,
              ),
            { delayInMs: this.opts.runRetryDelay, span, onlyEmitError: true },
          );
          return failed;
        } finally {
          span?.setAttributes({
            [TelemetryAttributes.JobFinishedTimestamp]: Date.now(),
            [TelemetryAttributes.JobProcessedTimestamp]: processedOn,
          });
        }
      },
      srcPropagationMedatada,
    );
  }

  private getUnrecoverableErrorMessage(
    job: Job<DataType, ResultType, NameType>,
  ) {
    if (job.deferredFailure) {
      return job.deferredFailure;
    }
    if (
      this.opts.maxStartedAttempts &&
      this.opts.maxStartedAttempts < job.attemptsStarted
    ) {
      return 'job started more than allowable limit';
    }
  }

  protected async handleCompleted(
    result: ResultType,
    job: Job<DataType, ResultType, NameType>,
    token: string,
    fetchNextCallback = () => true,
    jobsInProgress: Set<{ job: Job; ts: number }>,
    inProgressItem: { job: Job; ts: number },
    span?: Span,
  ) {
    jobsInProgress.delete(inProgressItem);

    if (!this.connection.closing) {
      const completed = await job.moveToCompleted(
        result,
        token,
        fetchNextCallback() && !(this.closing || this.paused),
      );
      this.emit('completed', job, result, 'active');

      span?.addEvent('job completed', {
        [TelemetryAttributes.JobResult]: JSON.stringify(result),
      });

      const [jobData, jobId, rateLimitDelay, delayUntil] = completed || [];
      this.updateDelays(rateLimitDelay, delayUntil);

      return this.nextJobFromJobData(jobData, jobId, token);
    }
  }

  protected async handleFailed(
    err: Error,
    job: Job<DataType, ResultType, NameType>,
    token: string,
    fetchNextCallback = () => true,
    jobsInProgress: Set<{ job: Job; ts: number }>,
    inProgressItem: { job: Job; ts: number },
    span?: Span,
  ) {
    jobsInProgress.delete(inProgressItem);

    if (!this.connection.closing) {
      // Check if the job was manually rate-limited
      if (err.message === RATE_LIMIT_ERROR) {
        const rateLimitTtl = await this.moveLimitedBackToWait(job, token);
        this.limitUntil = rateLimitTtl > 0 ? Date.now() + rateLimitTtl : 0;
        return;
      }

      if (
        err instanceof DelayedError ||
        err.name == 'DelayedError' ||
        err instanceof WaitingError ||
        err.name == 'WaitingError' ||
        err instanceof WaitingChildrenError ||
        err.name == 'WaitingChildrenError'
      ) {
        const client = await this.client;
        return this.moveToActive(client, token, this.opts.name);
      }

      const result = await job.moveToFailed(
        err,
        token,
        fetchNextCallback() && !(this.closing || this.paused),
      );
      this.emit('failed', job, err, 'active');

      span?.addEvent('job failed', {
        [TelemetryAttributes.JobFailedReason]: err.message,
      });

      if (result) {
        const [jobData, jobId, rateLimitDelay, delayUntil] = result;
        this.updateDelays(rateLimitDelay, delayUntil);
        return this.nextJobFromJobData(jobData, jobId, token);
      }
    }
  }

  /**
   *
   * Pauses the processing of this queue only for this worker.
   */
  async pause(doNotWaitActive?: boolean): Promise<void> {
    await this.trace<void>(
      SpanKind.INTERNAL,
      'pause',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.WorkerId]: this.id,
          [TelemetryAttributes.WorkerName]: this.opts.name,
          [TelemetryAttributes.WorkerDoNotWaitActive]: doNotWaitActive,
        });

        if (!this.paused) {
          this.paused = true;
          if (!doNotWaitActive) {
            await this.whenCurrentJobsFinished();
          }
          this.stalledCheckStopper?.();
          this.emit('paused');
        }
      },
    );
  }

  /**
   *
   * Resumes processing of this worker (if paused).
   */
  resume(): void {
    if (!this.running) {
      this.trace<void>(SpanKind.INTERNAL, 'resume', this.name, span => {
        span?.setAttributes({
          [TelemetryAttributes.WorkerId]: this.id,
          [TelemetryAttributes.WorkerName]: this.opts.name,
        });

        this.paused = false;

        if (this.processFn) {
          this.run();
        }
        this.emit('resumed');
      });
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
   * current jobs to be processed. When using telemetry, be mindful that it can
   * interfere with the proper closure of spans, potentially preventing them from being exported.
   *
   * @returns Promise that resolves when the worker has been closed.
   */
  async close(force = false): Promise<void> {
    if (this.closing) {
      return this.closing;
    }

    this.closing = (async () => {
      await this.trace<void>(
        SpanKind.INTERNAL,
        'close',
        this.name,
        async span => {
          span?.setAttributes({
            [TelemetryAttributes.WorkerId]: this.id,
            [TelemetryAttributes.WorkerName]: this.opts.name,
            [TelemetryAttributes.WorkerForceClose]: force,
          });
          this.emit('closing', 'closing queue');
          this.abortDelayController?.abort();

          // Define the async cleanup functions
          const asyncCleanups = [
            () => {
              return force || this.whenCurrentJobsFinished(false);
            },
            () => this.childPool?.clean(),
            () => this.blockingConnection.close(force),
            () => this.connection.close(force),
          ];

          // Run cleanup functions sequentially and make sure all are run despite any errors
          for (const cleanup of asyncCleanups) {
            try {
              await cleanup();
            } catch (err) {
              this.emit('error', <Error>err);
            }
          }

          clearTimeout(this.extendLocksTimer);
          this.stalledCheckStopper?.();

          this.closed = true;
          this.emit('closed');
        },
      );
    })();

    return await this.closing;
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
      if (!this.closing) {
        await this.trace<void>(
          SpanKind.INTERNAL,
          'startStalledCheckTimer',
          this.name,
          async span => {
            span?.setAttributes({
              [TelemetryAttributes.WorkerId]: this.id,
              [TelemetryAttributes.WorkerName]: this.opts.name,
            });

            this.stalledChecker().catch(err => {
              this.emit('error', <Error>err);
            });
          },
        );
      }
    }
  }

  private async stalledChecker() {
    while (!(this.closing || this.paused)) {
      await this.checkConnectionError(() => this.moveStalledJobsToWait());

      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, this.opts.stalledInterval);
        this.stalledCheckStopper = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
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
            if (isNotConnectionError(err as Error)) {
              this.emit('error', <Error>err);
            }
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

    if (this.mainLoopRunning) {
      await this.mainLoopRunning;
    }

    reconnect && (await this.blockingConnection.reconnect());
  }

  private async retryIfFailed<T>(
    fn: () => Promise<T>,
    opts: {
      delayInMs: number;
      span?: Span;
      maxRetries?: number;
      onlyEmitError?: boolean;
    },
  ): Promise<T> {
    let retry = 0;
    const maxRetries = opts.maxRetries || Infinity;

    do {
      try {
        return await fn();
      } catch (err) {
        opts.span?.recordException((<Error>err).message);

        if (isNotConnectionError(<Error>err)) {
          // Emit error when not paused or closing; optionally swallow (no throw) when opts.onlyEmitError is set.
          if (!this.paused && !this.closing) {
            this.emit('error', <Error>err);
          }

          if (opts.onlyEmitError) {
            return;
          } else {
            throw err;
          }
        } else {
          if (opts.delayInMs && !this.closing && !this.closed) {
            await this.delay(opts.delayInMs, this.abortDelayController);
          }

          if (retry + 1 >= maxRetries) {
            // If we've reached max retries, throw the last error
            throw err;
          }
        }
      }
    } while (++retry < maxRetries);
  }

  protected async extendLocks(jobs: Job[]) {
    await this.trace<void>(
      SpanKind.INTERNAL,
      'extendLocks',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.WorkerId]: this.id,
          [TelemetryAttributes.WorkerName]: this.opts.name,
          [TelemetryAttributes.WorkerJobsToExtendLocks]: jobs.map(
            job => job.id,
          ),
        });

        const erroredJobIds = await this.scripts.extendLocks(
          jobs.map(job => job.id),
          jobs.map(job => job.token),
          this.opts.lockDuration,
        );

        for (const jobId of erroredJobIds) {
          // TODO: Send signal to process function that the job has been lost.

          this.emit(
            'error',
            new Error(`could not renew lock for job ${jobId}`),
          );
        }
      },
    );
  }

  private async moveStalledJobsToWait() {
    await this.trace<void>(
      SpanKind.INTERNAL,
      'moveStalledJobsToWait',
      this.name,
      async span => {
        const stalled = await this.scripts.moveStalledJobsToWait();

        span?.setAttributes({
          [TelemetryAttributes.WorkerId]: this.id,
          [TelemetryAttributes.WorkerName]: this.opts.name,
          [TelemetryAttributes.WorkerStalledJobs]: stalled,
        });

        stalled.forEach((jobId: string) => {
          span?.addEvent('job stalled', {
            [TelemetryAttributes.JobId]: jobId,
          });
          this.emit('stalled', jobId, 'active');
        });
      },
    );
  }

  private moveLimitedBackToWait(
    job: Job<DataType, ResultType, NameType>,
    token: string,
  ) {
    return job.moveToWait(token);
  }
}
