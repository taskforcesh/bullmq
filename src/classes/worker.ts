import * as Bluebird from 'bluebird';
import fs from 'fs';
import IORedis from 'ioredis';
import path from 'path';
import { Processor, WorkerOptions } from '../interfaces';
import { QueueBase, Repeat } from './';
import { ChildPool, pool } from './child-pool';
import { Job } from './job';
import { RedisConnection } from './redis-connection';
import sandbox from './sandbox';
import { Scripts } from './scripts';
import uuid from 'uuid';

// note: sandboxed processors would also like to define concurrency per process
// for better resource utilization.

export const clientCommandMessageReg = /ERR unknown command '\s*client\s*'/;

export class Worker extends QueueBase {
  opts: WorkerOptions;

  private drained: boolean;
  private waiting = false;
  private processFn: Processor;

  private resumeWorker: () => void;
  private paused: Promise<void>;
  private _repeat: Repeat;
  private childPool: ChildPool;

  private blockingConnection: RedisConnection;

  private processing: Map<Promise<Job | string>, string>; // { [index: number]: Promise<Job | void> } = {};
  constructor(
    name: string,
    processor: string | Processor,
    opts: WorkerOptions = {},
  ) {
    super(name, opts);

    this.opts = {
      // settings: {},
      drainDelay: 5,
      concurrency: 1,
      lockDuration: 30000,
      ...this.opts,
    };

    this.opts.lockRenewTime =
      this.opts.lockRenewTime || this.opts.lockDuration / 2;

    this.blockingConnection = new RedisConnection(
      opts instanceof IORedis
        ? (<IORedis.Redis>opts.connection).duplicate()
        : opts.connection,
    );
    this.blockingConnection.on('error', this.emit.bind(this));

    if (typeof processor === 'function') {
      this.processFn = processor;
    } else {
      // SANDBOXED
      const supportedFileTypes = ['.js', '.ts', '.flow'];
      const processorFile =
        processor +
        (supportedFileTypes.includes(path.extname(processor)) ? '' : '.js');

      if (!fs.existsSync(processorFile)) {
        // TODO are we forced to use sync api here?
        throw new Error(`File ${processorFile} does not exist`);
      }

      this.childPool = this.childPool || pool;
      this.processFn = sandbox(processor, this.childPool).bind(this);
    }

    /* tslint:disable: no-floating-promises */
    this.run(); // TODO catch, emit error
  }

  get repeat() {
    return new Promise<Repeat>(async resolve => {
      if (!this._repeat) {
        const connection = await this.client;
        this._repeat = new Repeat(this.name, {
          ...this.opts,
          connection,
        });
      }
      resolve(this._repeat);
    });
  }

  private async run() {
    const client = await this.client;

    if (this.closing) {
      return;
    }

    // IDEA, How to store metadata associated to a worker.
    // create a key from the worker ID associated to the given name.
    // We keep a hash table bull:myqueue:workers where every worker is a hash key workername:workerId with json holding
    // metadata of the worker. The worker key gets expired every 30 seconds or so, we renew the worker metadata.
    //
    try {
      await client.client('setname', this.clientName());
    } catch (err) {
      if (!clientCommandMessageReg.test(err.message)) {
        throw err;
      }
    }

    const opts: WorkerOptions = <WorkerOptions>this.opts;

    const processing = (this.processing = new Map());

    const tokens: string[] = Array.from({ length: opts.concurrency }, () =>
      uuid.v4(),
    );

    while (!this.closing) {
      if (processing.size < opts.concurrency) {
        const token = tokens.pop();
        processing.set(
          this.getNextJob(token).catch(error => {
            console.error('getNextJob failed', error); // TODO handle error properly
          }),
          token,
        );
      }

      /*
       * Get the first promise that completes
       * Explanation https://stackoverflow.com/a/42898229/1848640
       */
      const [completed] = await Promise.race(
        [...processing.keys()].map(p => p.then(() => [p])),
      );

      const token = processing.get(completed);
      processing.delete(completed);

      const job = await completed;
      if (job) {
        // reuse same token if next job is available to process
        processing.set(
          this.processJob(job, token).catch(error => {
            console.error('processJob failed', error); // TODO handle error properly
          }),
          token,
        );
      } else {
        tokens.push(token);
      }
    }
    return Promise.all(processing);
  }

  /**
   * Returns a promise that resolves to the next job in queue.
   * @param token worker token to be assigned to retrieved job
   */
  async getNextJob(token: string): Promise<Job | void> {
    if (this.paused) {
      await this.paused;
    }

    if (this.closing) {
      return;
    }

    if (this.drained) {
      try {
        const jobId = await this.waitForJob();

        if (jobId) {
          return this.moveToActive(token, jobId);
        }
      } catch (err) {
        // Swallow error // TODO emit error
        if (err.message !== 'Connection is closed.') {
          console.error('BRPOPLPUSH', err);
        }
      }
    } else {
      return this.moveToActive(token);
    }
  }

  private async moveToActive(
    token: string,
    jobId?: string,
  ): Promise<Job | void> {
    const [jobData, id] = await Scripts.moveToActive(this, token, jobId);
    return this.nextJobFromJobData(jobData, id);
  }

  private async waitForJob() {
    const client = await this.blockingConnection.client;

    let jobId;
    const opts: WorkerOptions = <WorkerOptions>this.opts;

    try {
      this.waiting = true;
      jobId = await client.brpoplpush(
        this.keys.wait,
        this.keys.active,
        opts.drainDelay,
      );
    } finally {
      this.waiting = false;
    }
    return jobId;
  }

  private async nextJobFromJobData(
    jobData?: any,
    jobId?: string,
  ): Promise<Job | void> {
    if (jobData) {
      this.drained = false;
      const job = Job.fromJSON(this, jobData, jobId);
      if (job.opts.repeat) {
        const repeat = await this.repeat;
        await repeat.addNextRepeatableJob(job.name, job.data, job.opts);
      }
      return job;
    } else if (!this.drained) {
      this.emit('drained');
      this.drained = true;
    }
  }

  async processJob(job: Job, token: string): Promise<Job | void> {
    if (!job || this.closing || this.paused) {
      return;
    }

    // code from Bull3..

    //
    // There are two cases to take into consideration regarding locks.
    // 1) The lock renewer fails to renew a lock, this should make this job
    // unable to complete, since some other worker is also working on it.
    // 2) The lock renewer is called more seldom than the check for stalled
    // jobs, so we can assume the job has been stalled and is already being processed
    // by another worker. See https://github.com/OptimalBits/bull/issues/308
    //
    let lockRenewId: string;
    let timerStopped = false;
    const lockExtender = () => {
      lockRenewId = this.setTimer(
        'lockExtender',
        this.opts.lockRenewTime,
        async () => {
          try {
            const result = await Scripts.extendLock(this, job.id, token);
            if (result && !timerStopped) {
              lockExtender();
            }
            // FIXME if result = 0, reject processFn promise to take next job?
          } catch (error) {
            console.error('Error extending lock ', error);
            // Somehow tell the worker this job should stop processing...
          }
        },
      );
    };
    const stopTimer = () => {
      timerStopped = true;
      this.clearTimer(lockRenewId);
    };

    // end copy-paste from Bull3

    const handleCompleted = async (result: any): Promise<Job | void> => {
      const jobData = await job.moveToCompleted(
        result,
        token,
        !(this.closing || this.paused),
      );
      this.emit('completed', job, result, 'active');
      // FIXME should we call nextJobFromJobData here to emit drained event?
      return jobData ? this.nextJobFromJobData(jobData[0], jobData[1]) : null;
    };

    const handleFailed = async (err: Error) => {
      let error = err;
      if (
        error instanceof Bluebird.OperationalError &&
        (<any>error).cause instanceof Error
      ) {
        error = (<any>error).cause; // Handle explicit rejection
      }

      await job.moveToFailed(err, token);
      this.emit('failed', job, error, 'active');
      // FIXME can we also fetch next job right away as in handleCompleted?
    };

    // TODO: how to cancel the processing? (null -> job.cancel() => throw CancelError()void)
    this.emit('active', job, null, 'waiting');

    lockExtender();
    try {
      const result = await this.processFn(job);
      return handleCompleted(result);
    } catch (err) {
      return handleFailed(err);
    } finally {
      stopTimer();
    }

    /*
      var timeoutMs = job.opts.timeout;

      if (timeoutMs) {
        jobPromise = jobPromise.timeout(timeoutMs);
      }
    */
    // Local event with jobPromise so that we can cancel job.
    // this.emit('active', job, jobPromise, 'waiting');

    // return jobPromise.then(handleCompleted).catch(handleFailed);
  }

  /**
   * Pauses the processing of this queue only for this worker.
   */
  async pause(doNotWaitActive?: boolean) {
    if (!this.paused) {
      this.paused = new Promise(resolve => {
        this.resumeWorker = function() {
          resolve();
          this.paused = null; // Allow pause to be checked externally for paused state.
          this.resumeWorker = null;
        };
      });
      await (!doNotWaitActive && this.whenCurrentJobsFinished());
      this.emit('paused');
    }
  }

  resume() {
    if (this.resumeWorker) {
      this.resumeWorker();
      this.emit('resumed');
    }
  }

  isPaused() {
    return !!this.paused;
  }

  /**
   * Returns a promise that resolves when active jobs are cleared
   *
   * @returns {Promise}
   */
  private async whenCurrentJobsFinished(reconnect = true) {
    //
    // Force reconnection of blocking connection to abort blocking redis call immediately.
    //
    this.waiting && (await this.blockingConnection.disconnect());

    if (this.processing) {
      await Promise.all(this.processing);
    }

    this.waiting && reconnect && (await this.blockingConnection.reconnect());
  }

  async close(force = false) {
    if (!this.closing) {
      this.emit('closing', 'closing queue');
      this.closing = new Promise(async (resolve, reject) => {
        try {
          const client = await this.blockingConnection.client;

          await this.resume();
          if (!force) {
            await this.whenCurrentJobsFinished(false);
          } else {
            await client.disconnect();
          }
          // await this.disconnect();
          await super.close();
        } catch (err) {
          reject(err);
        } finally {
          this.clearAllTimers();
          this.childPool && this.childPool.clean();
        }
        this.emit('closed');
        resolve();
      });
    }
  }

  // code from former TimerManager
  private timers: any = {};

  private setTimer(name: string, delay: number, fn: Function) {
    const id = uuid.v4();
    const timer = setTimeout(
      timeoutId => {
        this.clearTimer(timeoutId);
        try {
          fn();
        } catch (err) {
          console.error(err);
        }
      },
      delay,
      id,
    );

    // XXX only the timer is used, but the
    // other fields are useful for
    // troubleshooting/debugging
    this.timers[id] = {
      name,
      timer,
    };

    return id;
  }

  private clearTimer(id: string) {
    const timers = this.timers;
    const timer = timers[id];
    if (!timer) {
      return;
    }
    clearTimeout(timer.timer);
    delete timers[id];
  }

  private clearAllTimers() {
    Object.keys(this.timers).forEach(key => {
      this.clearTimer(key);
    });
  }
}
