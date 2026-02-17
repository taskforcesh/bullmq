import { parseExpression } from 'cron-parser';
import {
  JobSchedulerJson,
  JobSchedulerTemplateJson,
  RedisClient,
  RepeatBaseOptions,
  RepeatOptions,
} from '../interfaces';
import {
  JobSchedulerTemplateOptions,
  JobsOptions,
  RepeatStrategy,
} from '../types';
import { Job } from './job';
import { QueueBase } from './queue-base';
import { RedisConnection } from './redis-connection';
import { SpanKind, TelemetryAttributes } from '../enums';
import { array2obj } from '../utils';

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
    repeatOpts: Omit<RepeatOptions, 'key' | 'prevMillis'>,
    jobName: N,
    jobData: T,
    opts: JobSchedulerTemplateOptions,
    { override, producerId }: { override: boolean; producerId?: string },
  ): Promise<Job<T, R, N> | undefined> {
    const { every, limit, pattern, offset } = repeatOpts;

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

    if (repeatOpts.immediately && repeatOpts.every) {
      console.warn(
        "Using option immediately with every does not affect the job's schedule. Job will run immediately anyway.",
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
    if (endDate && now > new Date(endDate!).getTime()) {
      return;
    }

    const prevMillis = opts.prevMillis || 0;
    now = prevMillis < now ? now : prevMillis;

    // Check if we have a start date for the repeatable job
    const { immediately, ...filteredRepeatOpts } = repeatOpts;

    let nextMillis: number;
    const newOffset: number | null = null;

    if (pattern) {
      nextMillis = await this.repeatStrategy(now, repeatOpts, jobName);

      if (nextMillis < now) {
        nextMillis = now;
      }
    }

    if (nextMillis || every) {
      return this.trace<Job<T, R, N>>(
        SpanKind.PRODUCER,
        'add',
        `${this.name}.${jobName}`,
        async (span, srcPropagationMedatada) => {
          let telemetry = opts.telemetry;

          if (srcPropagationMedatada) {
            const omitContext = opts.telemetry?.omitContext;
            const telemetryMetadata =
              opts.telemetry?.metadata ||
              (!omitContext && srcPropagationMedatada);

            if (telemetryMetadata || omitContext) {
              telemetry = {
                metadata: telemetryMetadata,
                omitContext,
              };
            }
          }

          const mergedOpts = this.getNextJobOpts(
            nextMillis,
            jobSchedulerId,
            {
              ...opts,
              repeat: filteredRepeatOpts,
              telemetry,
            },
            iterationCount,
            newOffset,
          );

          if (override) {
            // Clamp nextMillis to now if it's in the past
            if (nextMillis < now) {
              nextMillis = now;
            }

            const [jobId, delay] = await this.scripts.addJobScheduler(
              jobSchedulerId,
              nextMillis,
              JSON.stringify(typeof jobData === 'undefined' ? {} : jobData),
              Job.optsAsJSON(opts),
              {
                name: jobName,
                startDate: repeatOpts.startDate
                  ? new Date(repeatOpts.startDate).getTime()
                  : undefined,
                endDate: endDate ? new Date(endDate).getTime() : undefined,
                tz: repeatOpts.tz,
                pattern,
                every,
                limit,
                offset: newOffset,
              },
              Job.optsAsJSON(mergedOpts),
              producerId,
            );

            // Ensure delay is a number (Dragonflydb may return it as a string)
            const numericDelay =
              typeof delay === 'string' ? parseInt(delay, 10) : delay;

            const job = new this.Job<T, R, N>(
              this,
              jobName,
              jobData,
              { ...mergedOpts, delay: numericDelay },
              jobId,
            );

            job.id = jobId;

            span?.setAttributes({
              [TelemetryAttributes.JobSchedulerId]: jobSchedulerId,
              [TelemetryAttributes.JobId]: job.id,
            });

            return job;
          } else {
            const jobId = await this.scripts.updateJobSchedulerNextMillis(
              jobSchedulerId,
              nextMillis,
              JSON.stringify(typeof jobData === 'undefined' ? {} : jobData),
              Job.optsAsJSON(mergedOpts),
              producerId,
            );

            if (jobId) {
              const job = new this.Job<T, R, N>(
                this,
                jobName,
                jobData,
                mergedOpts,
                jobId,
              );

              job.id = jobId;

              span?.setAttributes({
                [TelemetryAttributes.JobSchedulerId]: jobSchedulerId,
                [TelemetryAttributes.JobId]: job.id,
              });

              return job;
            }
          }
        },
      );
    }
  }

  private getNextJobOpts(
    nextMillis: number,
    jobSchedulerId: string,
    opts: JobsOptions,
    currentCount: number,
    offset?: number,
  ): JobsOptions {
    //
    // Generate unique job id for this iteration.
    //
    const jobId = this.getSchedulerNextJobId({
      jobSchedulerId,
      nextMillis,
    });

    const now = Date.now();
    const delay = nextMillis + offset - now;

    const mergedOpts: JobsOptions = {
      ...opts,
      jobId,
      delay: delay < 0 ? 0 : delay,
      timestamp: now,
      prevMillis: nextMillis,
      repeatJobKey: jobSchedulerId,
    };

    mergedOpts.repeat = {
      ...opts.repeat,
      offset,
      count: currentCount,
      startDate: opts.repeat?.startDate
        ? new Date(opts.repeat.startDate).getTime()
        : undefined,
      endDate: opts.repeat?.endDate
        ? new Date(opts.repeat.endDate).getTime()
        : undefined,
    };

    return mergedOpts;
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

    return this.transformSchedulerData<D>(key, jobData, next);
  }

  private transformSchedulerData<D>(
    key: string,
    jobData: any,
    next?: number,
  ): JobSchedulerJson<D> | undefined {
    if (jobData && Object.keys(jobData).length > 0) {
      const jobSchedulerData: JobSchedulerJson<D> = {
        key,
        name: jobData.name,
        next,
      };

      if (jobData.ic) {
        jobSchedulerData.iterationCount = parseInt(jobData.ic);
      }

      if (jobData.limit) {
        jobSchedulerData.limit = parseInt(jobData.limit);
      }

      if (jobData.startDate) {
        jobSchedulerData.startDate = parseInt(jobData.startDate);
      }

      if (jobData.endDate) {
        jobSchedulerData.endDate = parseInt(jobData.endDate);
      }

      if (jobData.tz) {
        jobSchedulerData.tz = jobData.tz;
      }

      if (jobData.pattern) {
        jobSchedulerData.pattern = jobData.pattern;
      }

      if (jobData.every) {
        jobSchedulerData.every = parseInt(jobData.every);
      }

      if (jobData.offset) {
        jobSchedulerData.offset = parseInt(jobData.offset);
      }

      if (jobData.data || jobData.opts) {
        jobSchedulerData.template = this.getTemplateFromJSON<D>(
          jobData.data,
          jobData.opts,
        );
      }

      return jobSchedulerData;
    }

    // TODO: remove this check and keyToData as it is here only to support legacy code
    if (key.includes(':')) {
      return this.keyToData(key, next);
    }
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

  async getScheduler<D = any>(
    id: string,
  ): Promise<JobSchedulerJson<D> | undefined> {
    const [rawJobData, next] = await this.scripts.getJobScheduler(id);

    return this.transformSchedulerData<D>(
      id,
      rawJobData ? array2obj(rawJobData) : null,
      next ? parseInt(next) : null,
    );
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
      template.opts = Job.optsFromJSON(rawOpts);
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

  const dateFromMillis = new Date(millis);
  const startDate = opts.startDate && new Date(opts.startDate);
  const currentDate = startDate > dateFromMillis ? startDate : dateFromMillis;
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
