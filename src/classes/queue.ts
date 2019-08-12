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

  constructor(name: string, opts?: QueueOptions) {
    super(name, opts);

    this.repeat = new Repeat(name, {
      ...opts,
      connection: this.client,
    });
  }

  async append(jobName: string, data: any, opts?: JobsOpts) {
    if (opts && opts.repeat) {
      return this.repeat.addNextRepeatableJob(
        jobName,
        data,
        opts,
        opts.jobId,
        true,
      );
    } else {
      const job = await Job.create(this, jobName, data, opts);
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

  async drain() {}
}
