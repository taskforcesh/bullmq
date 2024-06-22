import { parseExpression } from 'cron-parser';
import { createHash } from 'crypto';
import {
  RedisClient,
  RepeatBaseOptions,
  RepeatableJob,
  RepeatOptions,
} from '../interfaces';
import { JobsOptions, RepeatStrategy } from '../types';
import { Job } from './job';
import { QueueBase } from './queue-base';
import { RedisConnection } from './redis-connection';

export class Repeat extends QueueBase {
  private repeatStrategy: RepeatStrategy;
  private repeatKeyHashAlgorithm: string;

  constructor(
    name: string,
    opts: RepeatBaseOptions,
    Connection?: typeof RedisConnection,
  ) {
    super(name, opts, Connection);

    this.repeatStrategy =
      (opts.settings && opts.settings.repeatStrategy) || getNextMillis;

    this.repeatKeyHashAlgorithm =
      (opts.settings && opts.settings.repeatKeyHashAlgorithm) || 'md5';
  }

  async addNextRepeatableJob<T = any, R = any, N extends string = string>(
    name: N,
    data: T,
    opts: JobsOptions,
    skipCheckExists?: boolean,
  ): Promise<Job<T, R, N> | undefined> {
    // HACK: This is a temporary fix to enable easy migration from bullmq <3.0.0
    // to >= 3.0.0. TODO: It should be removed when moving to 4.x.
    const repeatOpts: RepeatOptions & { cron?: string } = { ...opts.repeat };
    repeatOpts.pattern ??= repeatOpts.cron;
    delete repeatOpts.cron;

    const prevMillis = opts.prevMillis || 0;
    const currentCount = repeatOpts.count ? repeatOpts.count + 1 : 1;

    if (
      typeof repeatOpts.limit !== 'undefined' &&
      currentCount > repeatOpts.limit
    ) {
      return;
    }

    let now = Date.now();

    if (
      !(typeof repeatOpts.endDate === undefined) &&
      now > new Date(repeatOpts.endDate!).getTime()
    ) {
      return;
    }

    now = prevMillis < now ? now : prevMillis;

    const nextMillis = await this.repeatStrategy(now, repeatOpts, name);
    const pattern = repeatOpts.pattern;

    const hasImmediately = Boolean(
      (repeatOpts.every || pattern) && repeatOpts.immediately,
    );
    const offset = hasImmediately ? now - nextMillis : undefined;
    if (nextMillis) {
      // We store the undecorated opts.jobId into the repeat options
      if (!prevMillis && opts.jobId) {
        repeatOpts.jobId = opts.jobId;
      }

      const optionsConcat = getRepeatKey(name, repeatOpts);

      const repeatJobKey = await this.scripts.addRepeatableJob(
        opts.repeat.key ?? this.hash(optionsConcat),
        nextMillis,
        {
          name,
          endDate: repeatOpts.endDate
            ? new Date(repeatOpts.endDate).getTime()
            : undefined,
          tz: repeatOpts.tz,
          pattern: repeatOpts.pattern,
          every: repeatOpts.every,
        },
        optionsConcat,
        skipCheckExists,
      );

      const { immediately, ...filteredRepeatOpts } = repeatOpts;

      // The job could have been deleted since this check
      if (repeatJobKey) {
        return this.createNextJob<T, R, N>(
          name,
          nextMillis,
          repeatJobKey,
          { ...opts, repeat: { offset, ...filteredRepeatOpts } },
          data,
          currentCount,
          hasImmediately,
        );
      }
    }
  }

  private async createNextJob<T = any, R = any, N extends string = string>(
    name: N,
    nextMillis: number,
    repeatJobKey: string,
    opts: JobsOptions,
    data: T,
    currentCount: number,
    hasImmediately: boolean,
  ) {
    //
    // Generate unique job id for this iteration.
    //
    const jobId = this.getRepeatDelayedJobId({
      customKey: repeatJobKey,
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
      repeatJobKey,
    };

    mergedOpts.repeat = { ...opts.repeat, count: currentCount };

    return this.Job.create<T, R, N>(this, name, data, mergedOpts);
  }

  async removeRepeatable(
    name: string,
    repeat: RepeatOptions,
    jobId?: string,
  ): Promise<number> {
    const optionsConcat = getRepeatKey(name, { ...repeat, jobId });
    const repeatJobKey = repeat.key ?? this.hash(optionsConcat);
    const oldRepeatJobId = this.getRepeatJobId({
      name,
      nextMillis: '',
      namespace: this.hash(optionsConcat),
      jobId: jobId ?? repeat.jobId,
      key: repeat.key,
    });

    return this.scripts.removeRepeatable(
      oldRepeatJobId,
      optionsConcat,
      repeatJobKey,
    );
  }

  async removeRepeatableByKey(repeatJobKey: string): Promise<number> {
    const data = this.keyToData(repeatJobKey);

    const oldRepeatJobId = this.getRepeatJobId({
      name: data.name,
      nextMillis: '',
      namespace: this.hash(repeatJobKey),
      jobId: data.id,
    });

    return this.scripts.removeRepeatable(oldRepeatJobId, '', repeatJobKey);
  }

  private async getRepeatableData(
    client: RedisClient,
    key: string,
    next?: number,
  ): Promise<RepeatableJob> {
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

  private keyToData(key: string, next?: number): RepeatableJob {
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

  async getRepeatableJobs(
    start = 0,
    end = -1,
    asc = false,
  ): Promise<RepeatableJob[]> {
    const client = await this.client;

    const key = this.keys.repeat;
    const result = asc
      ? await client.zrange(key, start, end, 'WITHSCORES')
      : await client.zrevrange(key, start, end, 'WITHSCORES');

    const jobs = [];
    for (let i = 0; i < result.length; i += 2) {
      jobs.push(
        this.getRepeatableData(client, result[i], parseInt(result[i + 1])),
      );
    }
    return Promise.all(jobs);
  }

  async getRepeatableCount(): Promise<number> {
    const client = await this.client;
    return client.zcard(this.toKey('repeat'));
  }

  private hash(str: string) {
    return createHash(this.repeatKeyHashAlgorithm).update(str).digest('hex');
  }

  private getRepeatDelayedJobId({
    nextMillis,
    customKey,
  }: {
    customKey: string;
    nextMillis: number | string;
  }) {
    return `repeat:${customKey}:${nextMillis}`;
  }

  private getRepeatJobId({
    name,
    nextMillis,
    namespace,
    jobId,
    key,
  }: {
    name?: string;
    nextMillis: number | string;
    namespace?: string;
    jobId?: string;
    key?: string;
  }) {
    const checksum = key ?? this.hash(`${name}${jobId || ''}${namespace}`);
    return `repeat:${checksum}:${nextMillis}`;
  }
}

function getRepeatKey(name: string, repeat: RepeatOptions) {
  const endDate = repeat.endDate ? new Date(repeat.endDate).getTime() : '';
  const tz = repeat.tz || '';
  const pattern = repeat.pattern;
  const suffix = (pattern ? pattern : String(repeat.every)) || '';
  const jobId = repeat.jobId ? repeat.jobId : '';

  return `${name}:${jobId}:${endDate}:${tz}:${suffix}`;
}

export const getNextMillis = (
  millis: number,
  opts: RepeatOptions,
): number | undefined => {
  const pattern = opts.pattern;
  if (pattern && opts.every) {
    throw new Error(
      'Both .pattern and .every options are defined for this repeatable job',
    );
  }

  if (opts.every) {
    return (
      Math.floor(millis / opts.every) * opts.every +
      (opts.immediately ? 0 : opts.every)
    );
  }

  const currentDate =
    opts.startDate && new Date(opts.startDate) > new Date(millis)
      ? new Date(opts.startDate)
      : new Date(millis);
  const interval = parseExpression(pattern, {
    ...opts,
    currentDate,
  });

  try {
    return interval.next().getTime();
  } catch (e) {
    // Ignore error
  }
};
