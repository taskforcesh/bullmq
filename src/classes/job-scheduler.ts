import { parseExpression } from 'cron-parser';
import {
  JobSchedulerJson,
  JobSchedulerTemplateJson,
  RedisClient,
  RepeatBaseOptions,
  RepeatOptions,
} from '../interfaces';
import { JobsOptions, RepeatStrategy } from '../types';
import { Job } from './job';
import { QueueBase } from './queue-base';
import { RedisConnection } from './redis-connection';
import { SpanKind, TelemetryAttributes } from '../enums';
import { optsAsJSON, optsFromJSON } from '../utils';

export class JobScheduler extends QueueBase {
  private repeatStrategy: RepeatStrategy;

  constructor(
    name: string,
    opts: RepeatBaseOptions,
    Connection?: typeof RedisConnection,
  ) {
    super(name, opts, Connection);

    this.repeatStrategy =
      (opts.settings && opts.settings.repeatStrategy) || defaultRepeatStrategy;
  }

  async upsertJobScheduler<T = any, R = any, N extends string = string>(
    jobSchedulerId: string,
    repeatOpts: Omit<RepeatOptions, 'key' | 'prevMillis' | 'offset'>,
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

    if (!pattern && !every) {
      throw new Error(
        'Either .pattern or .every options must be defined for this repeatable job',
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

    // Check if we have a start date for the repeatable job
    const { startDate, immediately, ...filteredRepeatOpts } = repeatOpts;
    if (startDate) {
      const startMillis = new Date(startDate).getTime();
      now = startMillis > now ? startMillis : now;
    }

    let nextMillis: number;
    if (every) {
      nextMillis = prevMillis + every;

      if (nextMillis < now) {
        nextMillis = now;
      }
    } else if (pattern) {
      now = prevMillis < now ? now : prevMillis;
      nextMillis = await this.repeatStrategy(now, repeatOpts, jobName);
    }

    const multi = (await this.client).multi();
    if (nextMillis) {
      if (override) {
        this.scripts.addJobScheduler(
          (<unknown>multi) as RedisClient,
          jobSchedulerId,
          nextMillis,
          JSON.stringify(typeof jobData === 'undefined' ? {} : jobData),
          optsAsJSON(opts),
          {
            name: jobName,
            endDate: endDate ? new Date(endDate).getTime() : undefined,
            tz: repeatOpts.tz,
            pattern,
            every,
          },
        );
      } else {
        this.scripts.updateJobSchedulerNextMillis(
          (<unknown>multi) as RedisClient,
          jobSchedulerId,
          nextMillis,
        );
      }

      return this.trace<Job<T, R, N>>(
        SpanKind.PRODUCER,
        'add',
        `${this.name}.${jobName}`,
        async (span, srcPropagationMedatada) => {
          const job = this.createNextJob<T, R, N>(
            (<unknown>multi) as RedisClient,
            jobName,
            nextMillis,
            jobSchedulerId,
            {
              ...opts,
              repeat: filteredRepeatOpts,
              telemetryMetadata: srcPropagationMedatada,
            },
            jobData,
            iterationCount,
          );

          const results = await multi.exec(); // multi.exec returns an array of results [ err, result ][]

          // Check if there are any errors
          const erroredResult = results.find(result => result[0]);
          if (erroredResult) {
            throw new Error(
              `Error upserting job scheduler ${jobSchedulerId} - ${erroredResult[0]}`,
            );
          }

          // Get last result with the job id
          const lastResult = results.pop();
          job.id = lastResult[1] as string;

          span?.setAttributes({
            [TelemetryAttributes.JobSchedulerId]: jobSchedulerId,
            [TelemetryAttributes.JobId]: job.id,
          });

          return job;
        },
      );
    }
  }

  private createNextJob<T = any, R = any, N extends string = string>(
    client: RedisClient,
    name: N,
    nextMillis: number,
    jobSchedulerId: string,
    opts: JobsOptions,
    data: T,
    currentCount: number,
  ) {
    //
    // Generate unique job id for this iteration.
    //
    const jobId = this.getSchedulerNextJobId({
      jobSchedulerId,
      nextMillis,
    });

    const now = Date.now();
    const delay = nextMillis - now;

    const mergedOpts = {
      ...opts,
      jobId,
      delay: delay < 0 ? 0 : delay,
      timestamp: now,
      prevMillis: nextMillis,
      repeatJobKey: jobSchedulerId,
    };

    mergedOpts.repeat = { ...opts.repeat, count: currentCount };

    const job = new this.Job<T, R, N>(this, name, data, mergedOpts, jobId);
    job.addJob(client);

    return job;
  }

  async removeJobScheduler(jobSchedulerId: string): Promise<number> {
    return this.scripts.removeJobScheduler(jobSchedulerId);
  }

  private async getSchedulerData<D>(
    client: RedisClient,
    key: string,
    next?: number,
  ): Promise<JobSchedulerJson<D>> {
    const jobData = await client.hgetall(this.toKey('repeat:' + key));

    if (jobData) {
      return {
        key,
        name: jobData.name,
        endDate: parseInt(jobData.endDate) || null,
        tz: jobData.tz || null,
        pattern: jobData.pattern || null,
        every: jobData.every || null,
        ...(jobData.data || jobData.opts
          ? {
              template: this.getTemplateFromJSON<D>(jobData.data, jobData.opts),
            }
          : {}),
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

  async getJobScheduler<D = any>(id: string): Promise<JobSchedulerJson<D>> {
    const client = await this.client;
    const schedulerAttributes = await client.hgetall(
      this.toKey('repeat:' + id),
    );

    if (schedulerAttributes) {
      return {
        key: id,
        name: schedulerAttributes.name,
        endDate: parseInt(schedulerAttributes.endDate) || null,
        tz: schedulerAttributes.tz || null,
        pattern: schedulerAttributes.pattern || null,
        every: schedulerAttributes.every || null,
        ...(schedulerAttributes.data || schedulerAttributes.opts
          ? {
              template: this.getTemplateFromJSON<D>(
                schedulerAttributes.data,
                schedulerAttributes.opts,
              ),
            }
          : {}),
      };
    }
  }

  private getTemplateFromJSON<D = any>(
    rawData?: string,
    rawOpts?: string,
  ): JobSchedulerTemplateJson<D> {
    const template: JobSchedulerTemplateJson<D> = {};
    if (rawData) {
      template.data = JSON.parse(rawData);
    }
    if (rawOpts) {
      template.opts = optsFromJSON(rawOpts);
    }
    return template;
  }

  async getJobSchedulers<D = any>(
    start = 0,
    end = -1,
    asc = false,
  ): Promise<JobSchedulerJson<D>[]> {
    const client = await this.client;
    const jobSchedulersKey = this.keys.repeat;

    const result = asc
      ? await client.zrange(jobSchedulersKey, start, end, 'WITHSCORES')
      : await client.zrevrange(jobSchedulersKey, start, end, 'WITHSCORES');

    const jobs = [];
    for (let i = 0; i < result.length; i += 2) {
      jobs.push(
        this.getSchedulerData<D>(client, result[i], parseInt(result[i + 1])),
      );
    }
    return Promise.all(jobs);
  }

  async getSchedulersCount(): Promise<number> {
    const jobSchedulersKey = this.keys.repeat;
    const client = await this.client;

    return client.zcard(jobSchedulersKey);
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

export const defaultRepeatStrategy = (
  millis: number,
  opts: RepeatOptions,
): number | undefined => {
  const { pattern } = opts;

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
