import * as Bluebird from 'bluebird';
import fs from 'fs';
import { Redis } from 'ioredis';
import path from 'path';
import { Processor, WorkerOptions } from '../interfaces';
import { QueueBase, Repeat } from './';
import { ChildPool, pool } from './child-pool';
import { Job } from './job';
import { RedisConnection } from './redis-connection';
import sandbox from './sandbox';
import { Scripts } from './scripts';

// note: sandboxed processors would also like to define concurrency per process
// for better resource utilization.

export const clientCommandMessageReg = /ERR unknown command '\s*client\s*'/;

export class Worker extends QueueBase {
  bclient: Redis;
  opts: WorkerOptions;

  private drained: boolean;
  private waiting = false;
  private processFn: Processor;

  private resumeWorker: () => void;
  private paused: Promise<void>;
  private repeat: Repeat;
  private childPool: ChildPool;

  private bconnection: RedisConnection;
  private binitializing: Promise<Redis>;

  private processing: Set<Promise<Job | void>>; // { [index: number]: Promise<Job | void> } = {};
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
      ...this.opts,
    };

    this.bconnection = new RedisConnection(opts.connection);
    this.binitializing = this.bconnection.init();

    this.binitializing
      .then(client => client.on('error', this.emit.bind(this)))
      .then(client => (this.bclient = client))
      .catch(err => this.emit('error', err));

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

    this.repeat = new Repeat(name, opts);

    /* tslint:disable: no-floating-promises */
    this.run();
  }

  async waitUntilReady() {
    await this.binitializing;
    return super.waitUntilReady();
  }

  private async run() {
    await this.waitUntilReady();

    // IDEA, How to store metadata associated to a worker.
    // create a key from the worker ID associated to the given name.
    // We keep a hash table bull:myqueue:workers where every worker is a hash key workername:workerId with json holding
    // metadata of the worker. The worker key gets expired every 30 seconds or so, we renew the worker metadata.
    //
    try {
      await this.bclient.client('setname', this.clientName());
    } catch (err) {
      if (!clientCommandMessageReg.test(err.message)) {
        throw err;
      }
    }

    const opts: WorkerOptions = <WorkerOptions>this.opts;

    const processing = (this.processing = new Set());

    while (!this.closing) {
      if (processing.size < opts.concurrency) {
        processing.add(this.getNextJob());
      }

      //
      // Get the first promise that completes
      //
      const [completed] = await Promise.race(
        [...processing].map(p => p.then(res => [p])),
      );

      processing.delete(completed);

      const job = await completed;

      if (job) {
        processing.add(this.processJob(job));
      }
    }
    return Promise.all(processing);
  }

  /**
    Returns a promise that resolves to the next job in queue.
  */
  async getNextJob() {
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
          return this.moveToActive(jobId);
        }
      } catch (err) {
        // Swallow error
        if (err.message !== 'Connection is closed.') {
          console.error('BRPOPLPUSH', err);
        }
      }
    } else {
      return this.moveToActive();
    }
  }

  private async moveToActive(jobId?: string) {
    const [jobData, id] = await Scripts.moveToActive(this, jobId);
    return this.nextJobFromJobData(jobData, id);
  }

  private async waitForJob() {
    let jobId;
    const opts: WorkerOptions = <WorkerOptions>this.opts;

    try {
      this.waiting = true;
      jobId = await this.bclient.brpoplpush(
        this.keys.wait,
        this.keys.active,
        opts.drainDelay,
      );
    } finally {
      this.waiting = false;
    }
    return jobId;
  }

  private async nextJobFromJobData(jobData: any, jobId: string) {
    if (jobData) {
      this.drained = false;
      const job = Job.fromJSON(this, jobData, jobId);
      if (job.opts.repeat) {
        await this.repeat.addNextRepeatableJob(job.name, job.data, job.opts);
      }
      return job;
    } else if (!this.drained) {
      this.emit('drained');
      this.drained = true;
    }
  }

  async processJob(job: Job) {
    if (!job || this.closing || this.paused) {
      return;
    }
    const handleCompleted = async (result: any) => {
      const jobData = await job.moveToCompleted(
        result,
        !(this.closing || this.paused),
      );
      this.emit('completed', job, result, 'active');
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

      await job.moveToFailed(err);
      this.emit('failed', job, error, 'active');
    };

    // TODO: how to cancel the processing? (null -> job.cancel() => throw CancelError()void)
    this.emit('active', job, null, 'waiting');

    try {
      const result = await this.processFn(job);
      const nextJob = await handleCompleted(result);
      return nextJob;
    } catch (err) {
      return handleFailed(err);
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
    Pauses the processing of this queue only for this worker.
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
    this.waiting && (await this.bclient.disconnect());

    // If we are disconnected, how are we going to update the completed/failed sets?
    if (this.processing) {
      await Promise.all(this.processing);
    }

    this.waiting && reconnect && (await this.bclient.connect());
  }

  async close(force = false) {
    this.emit('closing', 'closing queue');
    await super.close();

    try {
      await this.resume();
      if (!force) {
        await this.whenCurrentJobsFinished(false);
      } else {
        await this.bclient.disconnect();
      }
      await this.disconnect();
    } finally {
      this.childPool && this.childPool.clean();
    }
    this.emit('closed');
  }
}
