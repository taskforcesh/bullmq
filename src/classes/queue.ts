import { JobsOpts, RateLimiterOpts, QueueOptions } from '@src/interfaces';
import { v4 } from 'node-uuid';
import { Job } from './job';
import { QueueGetters } from './queue-getters';
import { Scripts } from './scripts';
import { Repeat } from './repeat';
import { RepeatOpts } from '@src/interfaces/repeat-opts';

export class Queue extends QueueGetters {
  token = v4();
  limiter: RateLimiterOpts = null;
  repeat: Repeat;
  jobsOpts: JobsOpts;

  constructor(
    name: string,
    opts?: QueueOptions & { defaultJobOptions?: JobsOpts },
  ) {
    super(name, opts);

    this.repeat = new Repeat(name, {
      ...opts,
      connection: this.client,
    });

    this.jobsOpts = opts && opts.defaultJobOptions;
  }

  async append(jobName: string, data: any, opts?: JobsOpts) {
    if (opts && opts.repeat) {
      return this.repeat.addNextRepeatableJob(
        jobName,
        data,
        { ...opts, ...this.jobsOpts },
        true,
      );
    } else {
      const job = await Job.create(this, jobName, data, {
        ...opts,
        ...this.jobsOpts,
      });
      this.emit('waiting', job);
      return job;
    }
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
    await this.waitUntilReady();
    await Scripts.pause(this, true);
    this.emit('paused');
  }

  async resume() {
    await this.waitUntilReady();
    await Scripts.pause(this, false);
    this.emit('resumed');
  }

  removeRepeatable(name: string, repeatOpts: RepeatOpts, jobId?: string) {
    return this.repeat.removeRepeatable(name, repeatOpts, jobId);
  }

  removeRepeatableByKey(key: string) {
    return this.repeat.removeRepeatableByKey(key);
  }

  /**
   * Drains the queue, i.e., removes all jobs that are waiting
   * or delayed, but not active, completed or failed.
   *
   * TODO: Convert to an atomic LUA script.
   */
  async drain(delayed = false) {
    // Get all jobids and empty all lists atomically.
    let multi = this.client.multi();

    multi.lrange(this.toKey('wait'), 0, -1);
    multi.lrange(this.toKey('paused'), 0, -1);
    if (delayed) {
      // TODO: get delayed jobIds too!
      multi.del(this.toKey('delayed'));
    }
    multi.del(this.toKey('wait'));
    multi.del(this.toKey('paused'));
    multi.del(this.toKey('meta-paused'));
    multi.del(this.toKey('priority'));

    const [waiting, paused] = await multi.exec();
    const waitingjobs = waiting[1];
    const pausedJobs = paused[1];

    const jobKeys = pausedJobs.concat(waitingjobs).map(this.toKey, this);

    if (jobKeys.length) {
      multi = this.client.multi();

      multi.del.apply(multi, jobKeys);
      return multi.exec();
    }
  }

  /*@function clean
   *
   * Cleans jobs from a queue. Similar to remove but keeps jobs within a certain
   * grace period.
   *
   * @param {int} grace - The grace period
   * @param {string} [type=completed] - The type of job to clean
   * Possible values are completed, wait, active, paused, delayed, failed. Defaults to completed.
   * @param {int} The max number of jobs to clean
   */
  async clean(grace: number, type = 'completed', limit: number) {
    await this.waitUntilReady();

    if (grace === undefined || grace === null) {
      throw new Error('You must define a grace period.');
    }

    if (!type) {
      type = 'completed';
    }

    if (
      ['completed', 'wait', 'active', 'paused', 'delayed', 'failed'].indexOf(
        type,
      ) === -1
    ) {
      throw new Error('Cannot clean unknown queue type ' + type);
    }

    const jobs = await Scripts.cleanJobsInSet(
      this,
      type,
      Date.now() - grace,
      limit,
    );
    return jobs;
  }
}
