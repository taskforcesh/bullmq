import { get } from 'lodash';
import { v4 } from 'uuid';
import {
  JobsOptions,
  QueueOptions,
  RateLimiterOptions,
  RepeatOptions,
} from '../interfaces';
import { Job, QueueGetters, Repeat } from './';
import { Scripts } from './scripts';

export class Queue<T = any> extends QueueGetters {
  token = v4();
  limiter: RateLimiterOptions = null;
  jobsOpts: JobsOptions;

  private _repeat: Repeat;

  constructor(name: string, opts?: QueueOptions) {
    super(name, opts);

    this.jobsOpts = get(opts, 'defaultJobOptions');

    // tslint:disable: no-floating-promises
    this.waitUntilReady().then(client => {
      client.hset(
        this.keys.meta,
        'opts.maxLenEvents',
        get(opts, 'streams.events.maxLen', 10000),
      );
    });
  }

  get defaultJobOptions() {
    return this.jobsOpts;
  }

  get repeat() {
    return new Promise<Repeat>(async resolve => {
      if (!this._repeat) {
        this._repeat = new Repeat(this.name, {
          ...this.opts,
          connection: await this.client,
        });
      }
      resolve(this._repeat);
    });
  }

  async add(name: string, data: T, opts?: JobsOptions) {
    if (opts && opts.repeat) {
      return (await this.repeat).addNextRepeatableJob(
        name,
        data,
        { ...this.jobsOpts, ...opts },
        true,
      );
    } else {
      const job = await Job.create(this, name, data, {
        ...this.jobsOpts,
        ...opts,
      });
      this.emit('waiting', job);
      return job;
    }
  }

  /**
   * Adds an array of jobs to the queue.
   * @method add
   * @param jobs: [] The array of jobs to add to the queue. Each job is defined by 3
   * properties, 'name', 'data' and 'opts'. They follow the same signature as 'Queue.add'.
   */
  async addBulk(jobs: { name: string; data: T; opts?: JobsOptions }[]) {
    return Job.createBulk(
      this,
      jobs.map(job => ({
        name: job.name,
        data: job.data,
        opts: { ...this.jobsOpts, ...job.opts },
      })),
    );
  }

  /**
    Pauses the processing of this queue globally.

    We use an atomic RENAME operation on the wait queue. Since
    we have blocking calls with BRPOPLPUSH on the wait queue, as long as the queue
    is renamed to 'paused', no new jobs will be processed (the current ones
    will run until finalized).

    Adding jobs requires a LUA script to check first if the paused list exist
    and in that case it will add it there instead of the wait list.
  */
  async pause() {
    await Scripts.pause(this, true);
    this.emit('paused');
  }

  async resume() {
    await Scripts.pause(this, false);
    this.emit('resumed');
  }

  async getRepeatableJobs(start?: number, end?: number, asc?: boolean) {
    return (await this.repeat).getRepeatableJobs(start, end, asc);
  }

  async removeRepeatable(
    name: string,
    repeatOpts: RepeatOptions,
    jobId?: string,
  ) {
    return (await this.repeat).removeRepeatable(name, repeatOpts, jobId);
  }

  async removeRepeatableByKey(key: string) {
    return (await this.repeat).removeRepeatableByKey(key);
  }

  /**
   * Drains the queue, i.e., removes all jobs that are waiting
   * or delayed, but not active, completed or failed.
   *
   * TODO: Convert to an atomic LUA script.
   */
  async drain(delayed = false) {
    // Get all jobids and empty all lists atomically.
    const client = await this.client;

    let multi = client.multi();

    multi.lrange(this.toKey('wait'), 0, -1);
    multi.lrange(this.toKey('paused'), 0, -1);
    if (delayed) {
      // TODO: get delayed jobIds too!
      multi.del(this.toKey('delayed'));
    }
    multi.del(this.toKey('wait'));
    multi.del(this.toKey('paused'));
    multi.del(this.toKey('priority'));

    const [waiting, paused] = await multi.exec();
    const waitingjobs = waiting[1];
    const pausedJobs = paused[1];

    const jobKeys = pausedJobs.concat(waitingjobs).map(this.toKey, this);

    if (jobKeys.length) {
      multi = client.multi();

      multi.del.apply(multi, jobKeys);
      return multi.exec();
    }
  }

  /*@function clean
   *
   * Cleans jobs from a queue. Similar to drain but keeps jobs within a certain
   * grace period.
   *
   * @param {number} grace - The grace period
   * @param {number} The max number of jobs to clean
   * @param {string} [type=completed] - The type of job to clean
   * Possible values are completed, wait, active, paused, delayed, failed. Defaults to completed.
   */
  async clean(
    grace: number,
    limit: number,
    type:
      | 'completed'
      | 'wait'
      | 'active'
      | 'paused'
      | 'delayed'
      | 'failed' = 'completed',
  ) {
    const jobs = await Scripts.cleanJobsInSet(
      this,
      type,
      Date.now() - grace,
      limit,
    );

    this.emit('cleaned', jobs, type);
    return jobs;
  }

  async trimEvents(maxLength: number) {
    const client = await this.client;
    return client.xtrim(this.keys.events, 'MAXLEN', '~', maxLength);
  }
}
