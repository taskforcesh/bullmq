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
import {
  clientCommandMessageReg,
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
import { TimerManager } from './timer-manager';

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
   */
  failed: (
    job: Job<DataType, ResultType, NameType>,
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
  private waiting = false;
  private running = false;
  private blockTimeout = 0;
  private limitUntil = 0;

  protected processFn: Processor<DataType, ResultType, NameType>;

  private resumeWorker: () => void;
  protected paused: Promise<void>;
  private _repeat: Repeat;
  private childPool: ChildPool;
  protected timerManager: TimerManager;

  private blockingConnection: RedisConnection;

  private processing: Set<Promise<void | Job<DataType, ResultType, NameType>>>;

  static RateLimitError() {
    return new Error(RATE_LIMIT_ERROR);
  }

  constructor(
    name: string,
    processor?: string | Processor<DataType, ResultType, NameType>,
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

    this.opts.lockRenewTime =
      this.opts.lockRenewTime || this.opts.lockDuration / 2;

    this.id = v4();

    this.blockingConnection = new RedisConnection(
      isRedisInstance(opts.connection)
        ? (<Redis>opts.connection).duplicate()
        : opts.connection,
    );
    this.blockingConnection.on('error', error => this.emit('error', error));

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

        let masterFile = path.join(__dirname, './master.js');
        try {
          fs.statSync(masterFile); // would throw if file not exists
        } catch (_) {
          masterFile = path.join(process.cwd(), 'dist/cjs/classes/master.js');
          fs.statSync(masterFile);
        }

        this.childPool = new ChildPool(masterFile);
        this.processFn = sandbox<DataType, ResultType, NameType>(
          processor,
          this.childPool,
        ).bind(this);
      }
      this.timerManager = new TimerManager();

      if (this.opts.autorun) {
        this.run().catch(error => this.emit('error', error));
      }
    }
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
    return this.Job.fromJSON(this, data, jobId) as Job<
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
    if (this.processFn) {
      if (!this.running) {
        try {
          this.running = true;
          const client = await this.blockingConnection.client;

          if (this.closing) {
            return;
          }

          try {
            await client.client('SETNAME', this.clientName(WORKER_SUFFIX));
          } catch (err) {
            if (!clientCommandMessageReg.test((<Error>err).message)) {
              throw err;
            }
          }

          this.runStalledJobsCheck();

          const processing = (this.processing = new Set());
          const token = v4();

          while (!this.closing) {
            if (
              !this.waiting &&
              processing.size < this.opts.concurrency &&
              (!this.limitUntil || processing.size == 0)
            ) {
              processing.add(
                this.retryIfFailed<Job<DataType, ResultType, NameType>>(
                  () => this.getNextJob(token),
                  this.opts.runRetryDelay,
                ),
              );
            }

            /*
             * Get the first promise that completes
             */
            const promises = [...processing.keys()];
            const completedIdx = await Promise.race(
              promises.map((p, idx) => p.then(() => idx)),
            );

            const completed = promises[completedIdx];

            processing.delete(completed);

            const job = await completed;
            if (job) {
              processing.add(
                this.retryIfFailed<void | Job<DataType, ResultType, NameType>>(
                  () =>
                    this.processJob(
                      job,
                      token,
                      () => processing.size <= this.opts.concurrency,
                    ),
                  this.opts.runRetryDelay,
                ),
              );
            }
          }
          this.running = false;
          return Promise.all([...processing.keys()]);
        } catch (error) {
          this.running = false;

          throw error;
        }
      } else {
        throw new Error('Worker is already running.');
      }
    } else {
      throw new Error('No process function is defined.');
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
  ): Promise<Job<DataType, ResultType, NameType>> {
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

    if (this.drained && block && !this.limitUntil) {
      try {
        const jobId = await this.waitForJob();
        return this.moveToActive(token, jobId);
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
        await delay(this.limitUntil);
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
    const [jobData, id, limitUntil, delayUntil] =
      await this.scripts.moveToActive(token, jobId);
    return this.nextJobFromJobData(jobData, id, limitUntil, delayUntil);
  }

  private async waitForJob() {
    // I am not sure returning here this quick is a good idea, the main
    // loop could stay looping at a very high speed and consume all CPU time.
    if (this.paused) {
      return;
    }

    try {
      const client = await this.blockingConnection.client;
      const opts: WorkerOptions = <WorkerOptions>this.opts;

      this.waiting = true;

      let blockTimeout = Math.max(
        this.blockTimeout ? this.blockTimeout / 1000 : opts.drainDelay,
        0.01,
      );

      // Only Redis v6.0.0 and above supports doubles as block time
      blockTimeout =
        this.blockingConnection.redisVersion < '6.0.0'
          ? Math.ceil(blockTimeout)
          : blockTimeout;

      const jobId = await client.brpoplpush(
        this.keys.wait,
        this.keys.active,
        blockTimeout,
      );
      return jobId;
    } catch (error) {
      if (isNotConnectionError(<Error>error)) {
        this.emit('error', <Error>error);
      }
      if (!this.closing) {
        await this.delay();
      }
    } finally {
      this.waiting = false;
    }
  }

  /**
   *
   * This function is exposed only for testing purposes.
   */
  async delay(): Promise<void> {
    await delay(DELAY_TIME_1);
  }

  protected async nextJobFromJobData(
    jobData?: JobJsonRaw,
    jobId?: string,
    limitUntil?: number,
    delayUntil?: number,
  ): Promise<Job<DataType, ResultType, NameType>> {
    if (!jobData) {
      if (!this.drained) {
        this.emit('drained');
        this.drained = true;
        this.blockTimeout = 0;
      }
    }

    this.limitUntil = Math.max(limitUntil, 0) || 0;
    this.blockTimeout = delayUntil;

    if (jobData) {
      this.drained = false;
      const job = this.createJob(jobData, jobId);
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
  ): Promise<void | Job<DataType, ResultType, NameType>> {
    if (!job || this.closing || this.paused) {
      return;
    }

    //
    // There are two cases to take into consideration regarding locks.
    // 1) The lock renewer fails to renew a lock, this should make this job
    // unable to complete, since some other worker is also working on it.
    // 2) The lock renewer is called more seldom than the check for stalled
    // jobs, so we can assume the job has been stalled and is already being processed
    // by another worker. See https://github.com/OptimalBits/bull/issues/308
    //
    // TODO: Have only 1 timer that extends all the locks instead of one timer
    // per concurrency setting.
    let lockRenewId: string;
    let timerStopped = false;
    const lockExtender = () => {
      lockRenewId = this.timerManager.setTimer(
        'lockExtender',
        this.opts.lockRenewTime,
        async () => {
          try {
            const result = await job.extendLock(token, this.opts.lockDuration);
            if (result && !timerStopped) {
              lockExtender();
            }
            // FIXME if result = 0 (missing lock), reject processFn promise to take next job?
          } catch (error) {
            console.error('Error extending lock ', error);
            // Somehow tell the worker this job should stop processing...
          }
        },
      );
    };

    const stopTimer = () => {
      timerStopped = true;
      this.timerManager.clearTimer(lockRenewId);
    };

    // end copy-paste from Bull3

    const handleCompleted = async (result: ResultType) => {
      if (!this.connection.closing) {
        const completed = await job.moveToCompleted(
          result,
          token,
          fetchNextCallback() && !(this.closing || this.paused),
        );
        this.emit('completed', job, result, 'active');
        const [jobData, jobId, limitUntil, delayUntil] = completed || [];
        return this.nextJobFromJobData(jobData, jobId, limitUntil, delayUntil);
      }
    };

    const handleFailed = async (err: Error) => {
      if (!this.connection.closing) {
        try {
          if (err.message == RATE_LIMIT_ERROR) {
            this.limitUntil = await this.moveLimitedBackToWait(job);
            return;
          }

          await job.moveToFailed(err, token);
          this.emit('failed', job, err, 'active');
        } catch (err) {
          this.emit('error', <Error>err);
          // It probably means that the job has lost the lock before completion
          // The QueueScheduler will (or already has) moved the job back
          // to the waiting list (as stalled)
        }
      }
    };

    this.emit('active', job, 'waiting');

    lockExtender();

    try {
      const result = await this.callProcessJob(job, token);
      return await handleCompleted(result);
    } catch (err) {
      return handleFailed(<Error>err);
    } finally {
      stopTimer();
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
        .finally(() => client.disconnect())
        .finally(() => this.timerManager && this.timerManager.clearAllTimers())
        .finally(() => this.connection.close())
        .finally(() => this.emit('closed'));
    })();
    return this.closing;
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

    if (this.processing) {
      await Promise.all(this.processing.keys());
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
          await delay(delayInMs);
        } else {
          return;
        }
      }
    } while (retry);
  }

  private async runStalledJobsCheck() {
    try {
      if (!this.closing) {
        await this.checkConnectionError(() => this.moveStalledJobsToWait());
        this.timerManager.setTimer(
          'checkStalledJobs',
          this.opts.stalledInterval,
          () => this.runStalledJobsCheck(),
        );
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
        Job.fromId<DataType, ResultType, NameType>(this, failed[i]),
      );

      if (i % chunkSize === 0) {
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

  private async moveLimitedBackToWait(
    job: Job<DataType, ResultType, NameType>,
  ) {
    const multi = (await this.client).multi();
    multi.pttl(this.keys.limiter);
    multi.lrem(this.keys.active, 1, job.id);
    multi.rpush(this.keys.wait, job.id);
    multi.del(`${this.toKey(job.id)}:lock`);
    const [[err, limitUntil]] = await multi.exec();
    return <number>limitUntil;
  }
}
