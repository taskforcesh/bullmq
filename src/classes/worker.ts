import { WorkerOptions, Processor } from '@src/interfaces/worker-opts';
import { QueueBase } from './queue-base';
import { Job } from './job';
import { Scripts } from './scripts';

import * as Bluebird from 'bluebird';
import IORedis from 'ioredis';
import { Repeat } from './repeat';
import fs from 'fs';
import path from 'path';
import { ChildPool } from './child-pool';
import sandbox from './sandbox';
import { pool } from './child-pool';

// note: sandboxed processors would also like to define concurrency per process
// for better resource utilization.

export const clientCommandMessageReg = /ERR unknown command '\s*client\s*'/;

export class Worker extends QueueBase {
  private drained: boolean;
  private waiting = false;
  private processFn: Processor;

  private resumeWorker: () => void;
  private paused: Promise<void>;
  private repeat: Repeat;
  private childPool: ChildPool;
  public opts: WorkerOptions;

  private processing: { [index: number]: Promise<Job | void> } = {};
  constructor(
    name: string,
    processor: string | Processor,
    opts: WorkerOptions = {},
  ) {
    super(name, opts);

    // FIXME this is not the same as merge, falsy values like undefined may overwrite defaults
    this.opts = {
      // settings: {},
      drainDelay: 5,
      concurrency: 1,
      ...this.opts,
    };

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

    //
    // We will reuse the repeat client connection for other things such as
    // job completion/failure, delay handling and stuck jobs.
    //

    this.run();
  }

  private async run() {
    await this.waitUntilReady();

    // IDEA, How to store metadata associated to a worker.
    // create a key from the worker ID associated to the given name.
    // We keep a hash table bull:myqueue:workers where every worker is a hash key workername:workerId with json holding
    // metadata of the worker. The worker key gets expired every 30 seconds or so, we renew the worker metadata.
    //
    try {
      await this.client.client('setname', this.clientName());
    } catch (err) {
      if (!clientCommandMessageReg.test(err.message)) {
        throw err;
      }
    }

    const opts: WorkerOptions = <WorkerOptions>this.opts;
    const processors = [];

    // An idea for implemeting the concurrency differently:
    /*
      const processing: Promise<[number, Job | void][] = this.processing = [];
      for(let i=0; i < concurrency; i++){
        this.processing.push([Promise.resolve(i), null])
      }
      
      while(!this.closing){
        // Get a free processing slot and maybe a job to process.
        const [index, job] = await Promise.race(this.processing);

        if(!job){
          job: Job | void = await this.getNextJob();
        }

        processing[index] = this.processJob(job).then( async () => [index, job])
      }
      return Promise.all(processing);
    */

    for (let i = 0; i < opts.concurrency; i++) {
      processors.push(this.processJobs(i));
    }

    return Promise.all(processors);
  }

  private async processJobs(index: number) {
    while (!this.closing) {
      let job: Job | void = await this.getNextJob();

      while (job) {
        this.processing[index] = this.processJob(job);
        job = await this.processing[index];
      }
    }
  }

  /**
    Returns a promise that resolves to the next job in queue.
  */
  async getNextJob() {
    if (this.closing) {
      return;
    }

    if (this.paused) {
      await this.paused;
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
      jobId = await this.client.brpoplpush(
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
    } else {
      if (!this.drained) {
        this.emit('drained');
      }
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
      return handleCompleted(result);
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
  private async whenCurrentJobsFinished() {
    //
    // Force reconnection of blocking connection to abort blocking redis call immediately.
    //
    this.waiting && (await redisClientDisconnect(this.client));
    const processingPromises = Object.values(this.processing);
    await Promise.all(processingPromises);
    this.waiting && (await this.client.connect());
  }

  close() {
    try {
      return super.close();
    } finally {
      this.childPool && this.childPool.clean();
    }
  }
}

async function redisClientDisconnect(client: IORedis.Redis) {
  if (client.status !== 'end') {
    let _resolve, _reject;

    const disconnecting = new Promise((resolve, reject) => {
      client.once('end', resolve);
      client.once('error', reject);
      _resolve = resolve;
      _reject = reject;
    });

    client.disconnect();

    try {
      await disconnecting;
    } finally {
      client.removeListener('end', _resolve);
      client.removeListener('error', _reject);
    }
  }
}
