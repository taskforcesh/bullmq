import { parseExpression } from 'cron-parser';
import { RedisClient, RepeatBaseOptions, RepeatOptions } from '../interfaces';
import { JobsOptions, RepeatStrategy } from '../types';
import { Job } from './job';
import { QueueBase } from './queue-base';
import { RedisConnection } from './redis-connection';

export interface JobSchedulerJson {
  key: string; // key is actually the job scheduler id
  name: string;
  id?: string | null;
  endDate: number | null;
  tz: string | null;
  pattern: string | null;
  every?: string | null;
  next: number;
}

export class JobScheduler extends QueueBase {
  private repeatStrategy: RepeatStrategy;

  constructor(
    name: string,
    opts: RepeatBaseOptions,
    Connection?: typeof RedisConnection,
  ) {
    super(name, opts, Connection);

    this.repeatStrategy =
      (opts.settings && opts.settings.repeatStrategy) || getNextMillis;
  }

  async upsertJobScheduler<T = any, R = any, N extends string = string>(
    jobSchedulerId: string,
    repeatOpts: Omit<RepeatOptions, 'key'>,
    jobName: N,
    jobData: T,
    opts: Omit<JobsOptions, 'jobId' | 'repeat' | 'delay'>,
    { override }: { override: boolean },
  ): Promise<Job<T, R, N> | undefined> {
    const { every, pattern } = repeatOpts;

    if (pattern && every) {
      throw new Error(
        'Both .pattern and .every options are defined for this repeatable job',
      );
    }

    if (repeatOpts.immediately && repeatOpts.startDate) {
      throw new Error(
        'Both .immediately and .startDate options are defined for this repeatable job',
      );
    }

    // Check if we reached the limit of the repeatable job's iterations
    const iterationCount = repeatOpts.count ? repeatOpts.count + 1 : 1;
    if (
      typeof repeatOpts.limit !== 'undefined' &&
      iterationCount > repeatOpts.limit
    ) {
      return;
    }

    // Check if we reached the end date of the repeatable job
    let now = Date.now();
    const { endDate } = repeatOpts;
    if (!(typeof endDate === undefined) && now > new Date(endDate!).getTime()) {
      return;
    }

    const prevMillis = opts.prevMillis || 0;
    now = prevMillis < now ? now : prevMillis;

    // Check if we have a start date for the repeatable job
    const { startDate } = repeatOpts;
    if (startDate) {
      const startMillis = new Date(startDate).getTime();
      now = startMillis > now ? startMillis : now;
    }

    const nextMillis = await this.repeatStrategy(now, repeatOpts, jobName);

    const hasImmediately = Boolean(
      (every || pattern) && repeatOpts.immediately,
    );
    const offset = hasImmediately && every ? now - nextMillis : undefined;
    if (nextMillis) {
      if (override) {
        await this.scripts.addJobScheduler(jobSchedulerId, nextMillis, {
          name: jobName,
          endDate: endDate ? new Date(endDate).getTime() : undefined,
          tz: repeatOpts.tz,
          pattern,
          every,
        });
      } else {
        await this.scripts.updateJobSchedulerNextMillis(
          jobSchedulerId,
          nextMillis,
        );
      }

      const { immediately, ...filteredRepeatOpts } = repeatOpts;

      return this.createNextJob<T, R, N>(
        jobName,
        nextMillis,
        jobSchedulerId,
        { ...opts, repeat: { offset, ...filteredRepeatOpts } },
        jobData,
        iterationCount,
        hasImmediately,
      );
    }
  }

  private async createNextJob<T = any, R = any, N extends string = string>(
    name: N,
    nextMillis: number,
    jobSchedulerId: string,
    opts: JobsOptions,
    data: T,
    currentCount: number,
    hasImmediately: boolean,
  ) {
    //
    // Generate unique job id for this iteration.
    //
    const jobId = this.getSchedulerNextJobId({
      jobSchedulerId: jobSchedulerId,
      nextMillis,
    });

    const now = Date.now();
    const delay =
      nextMillis + (opts.repeat.offset ? opts.repeat.offset : 0) - now;

    const mergedOpts = {
      ...opts,
      jobId,
      delay: delay < 0 || hasImmediately ? 0 : delay,
      timestamp: now,
      prevMillis: nextMillis,
      repeatJobKey: jobSchedulerId,
    };

    mergedOpts.repeat = { ...opts.repeat, count: currentCount };

    return this.Job.create<T, R, N>(this, name, data, mergedOpts);
  }

  async removeJobScheduler(jobSchedulerId: string): Promise<number> {
    return this.scripts.removeJobScheduler(jobSchedulerId);
  }

  private async getSchedulerData(
    client: RedisClient,
    key: string,
    next?: number,
  ): Promise<JobSchedulerJson> {
    const jobData = await client.hgetall(this.toKey('repeat:' + key));

    if (jobData) {
      return {
        key,
        name: jobData.name,
        endDate: parseInt(jobData.endDate) || null,
        tz: jobData.tz || null,
        pattern: jobData.pattern || null,
        every: jobData.every || null,
        next,
      };
    }

    return this.keyToData(key, next);
  }

  private keyToData(key: string, next?: number): JobSchedulerJson {
    const data = key.split(':');
    const pattern = data.slice(4).join(':') || null;

    return {
      key,
      name: data[0],
      id: data[1] || null,
      endDate: parseInt(data[2]) || null,
      tz: data[3] || null,
      pattern,
      next,
    };
  }

  async getJobSchedulers(
    start = 0,
    end = -1,
    asc = false,
  ): Promise<JobSchedulerJson[]> {
    const client = await this.client;
    const jobSchedulersKey = this.keys.repeat;

    const result = asc
      ? await client.zrange(jobSchedulersKey, start, end, 'WITHSCORES')
      : await client.zrevrange(jobSchedulersKey, start, end, 'WITHSCORES');

    const jobs = [];
    for (let i = 0; i < result.length; i += 2) {
      jobs.push(
        this.getSchedulerData(client, result[i], parseInt(result[i + 1])),
      );
    }
    return Promise.all(jobs);
  }

  async getSchedulersCount(
    client: RedisClient,
    prefix: string,
    queueName: string,
  ): Promise<number> {
    return client.zcard(`${prefix}:${queueName}:repeat`);
  }

  private getSchedulerNextJobId({
    nextMillis,
    jobSchedulerId,
  }: {
    jobSchedulerId: string;
    nextMillis: number | string;
  }) {
    return `repeat:${jobSchedulerId}:${nextMillis}`;
  }
}

export const getNextMillis = (
  millis: number,
  opts: RepeatOptions,
): number | undefined => {
  const { every, pattern } = opts;

  if (every) {
    return Math.floor(millis / every) * every + (opts.immediately ? 0 : every);
  }

  const currentDate = new Date(millis);
  const interval = parseExpression(pattern, {
    ...opts,
    currentDate,
  });

  try {
    if (opts.immediately) {
      return new Date().getTime();
    } else {
      return interval.next().getTime();
    }
  } catch (e) {
    // Ignore error
  }
};
