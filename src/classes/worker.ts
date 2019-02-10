import { WorkerOptions, Processor } from '@src/interfaces/worker-opts';
import { QueueBase } from './queue-base';
import { Job } from './job';
import { Scripts } from './scripts';

import * as Bluebird from 'bluebird';
import IORedis from 'ioredis';
import { Repeat } from './repeat';

// note: sandboxed processors would also like to define concurrency per process
// for better resource utilization.

export class Worker extends QueueBase {
  private drained: boolean;
  private processFn: Processor;

  private resumeWorker: () => void;
  private paused: Promise<void>;
  private repeat: Repeat;

  private processing: { [index: number]: Promise<Job | void> } = {};
  constructor(
    name: string,
    processor: string | Processor,
    opts: WorkerOptions = {},
  ) {
    super(name, opts);

    this.opts = Object.assign(
      {
        settings: {},
        drainDelay: 5000,
        concurrency: 1,
      },
      this.opts,
    );

    if (typeof processor === 'function') {
      this.processFn = processor;
    } else {
      // SANDBOXED
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
    await this.client.client('setname', this.clientName());

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

    if (this.drained) {
      //
      // Waiting for new jobs to arrive
      //
      try {
        const opts: WorkerOptions = <WorkerOptions>this.opts;

        const jobId = await this.client.brpoplpush(
          this.keys.wait,
          this.keys.active,
          opts.drainDelay,
        );
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
    if (!job) {
      return;
    }

    const handleCompleted = async (result: any) => {
      const jobData = await job.moveToCompleted(result);
      this.emit('completed', job, result, 'active');
      return jobData ? this.nextJobFromJobData(jobData[0], jobData[1]) : null;
    };

    const handleFailed = async (err: Error) => {
      let error = err;
      if (
        error instanceof Bluebird.OperationalError &&
        (<any>error).cause instanceof Error
      ) {
        error = (<any>error).cause; //Handle explicit rejection
      }

      await job.moveToFailed(err);
      this.emit('failed', job, error, 'active');
    };

    const jobPromise = this.processFn(job);

    /*
      var timeoutMs = job.opts.timeout;

      if (timeoutMs) {
        jobPromise = jobPromise.timeout(timeoutMs);
      }
    */

    // Local event with jobPromise so that we can cancel job.
    this.emit('active', job, jobPromise, 'waiting');

    return jobPromise.then(handleCompleted).catch(handleFailed);
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

  /**
   * Returns a promise that resolves when active jobs are cleared
   *
   * @returns {Promise}
   */
  private async whenCurrentJobsFinished() {
    //
    // Force reconnection of blocking connection to abort blocking redis call immediately.
    //
    await redisClientDisconnect(this.client);
    await Promise.all(Object.values(this.processing));

    this.client.connect();
  }
}

function redisClientDisconnect(client: IORedis.Redis) {
  if (client.status === 'end') {
    return Promise.resolve();
  }
  let _resolve: any, _reject: any;
  return new Promise(function(resolve, reject) {
    _resolve = resolve;
    _reject = reject;
    client.once('end', resolve);
    client.once('error', reject);

    client
      .quit()
      .catch(function(err) {
        if (err.message !== 'Connection is closed.') {
          throw err;
        }
      })
      //  .timeout(500)
      .catch(function() {
        client.disconnect();
      });
  }).finally(function() {
    client.removeListener('end', _resolve);
    client.removeListener('error', _reject);
  });
}
