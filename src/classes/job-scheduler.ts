import { CronExpressionParser } from 'cron-parser';
import {
  BackendFactory,
  JobSchedulerJson,
  JobSchedulerTemplateJson,
  RepeatBaseOptions,
  RepeatOptions,
} from '../interfaces';
import {
  JobSchedulerTemplateOptions,
  JobSchedulerJobOptions,
  RepeatStrategy,
} from '../types';
import { Job } from './job';
import { QueueBase } from './queue-base';
import { SpanKind, TelemetryAttributes } from '../enums';
import { array2obj } from '../utils';

export const LEGACY_REPEATABLE_JOBS_MIGRATION_URL =
  'https://docs.bullmq.io/guide/migrations/migrate-from-v5-to-v6';

/**
 * Legacy repeatable job keys use the format `name:id:endDate:tz:pattern`.
 * The cron pattern itself may contain additional colons, so legacy keys always
 * have at least five colon-separated segments.
 */
export function hasLegacyRepeatableKeyShape(key: string): boolean {
  return key.split(':').length >= 5;
}

export const isLegacyRepeatableJobKey = hasLegacyRepeatableKeyShape;

export function getLegacyRepeatableJobError(key: string): Error {
  return new Error(
    `Legacy repeatable job metadata is not supported in BullMQ v6 ` +
      `(key: "${key}"). Migrate legacy repeatable jobs to Job Schedulers ` +
      `before upgrading. See ${LEGACY_REPEATABLE_JOBS_MIGRATION_URL}`,
  );
}

export class JobScheduler extends QueueBase {
  private repeatStrategy: RepeatStrategy;

  constructor(
    name: string,
    opts: RepeatBaseOptions,
    backendFactory?: BackendFactory,
  ) {
    super(name, opts, backendFactory);

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
    const newOffset: number | null = every && offset ? offset : null;

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
        async (span, srcPropagationMetadata) => {
          let telemetry = opts.telemetry;

          if (srcPropagationMetadata) {
            const omitContext = opts.telemetry?.omitContext;
            const telemetryMetadata =
              opts.telemetry?.metadata ||
              (!omitContext && srcPropagationMetadata);

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

            const [jobId, delay] = await this.backend.addJobScheduler(
              jobSchedulerId,
              nextMillis,
              JSON.stringify(typeof jobData === 'undefined' ? {} : jobData),
              opts,
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
              mergedOpts,
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
            const jobId = await this.backend.updateJobSchedulerNextMillis(
              jobSchedulerId,
              nextMillis,
              JSON.stringify(typeof jobData === 'undefined' ? {} : jobData),
              mergedOpts,
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
    opts: JobSchedulerJobOptions,
    currentCount: number,
    offset?: number,
  ): JobSchedulerJobOptions {
    //
    // Generate unique job id for this iteration.
    //
    const jobId = this.getSchedulerNextJobId({
      jobSchedulerId,
      nextMillis,
    });

    const now = Date.now();
    const delay = nextMillis + offset - now;

    const mergedOpts: JobSchedulerJobOptions = {
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
    return this.backend.removeJobScheduler(jobSchedulerId);
  }

  private async getSchedulerData<D>(
    key: string,
    next?: number,
  ): Promise<JobSchedulerJson<D> | undefined> {
    const jobData = await this.backend.getJobSchedulerData(key);

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

    if (hasLegacyRepeatableKeyShape(key)) {
      throw getLegacyRepeatableJobError(key);
    }

    return undefined;
  }

  /**
   * Checks if a given id corresponds to a registered job scheduler.
   *
   * This is used to disambiguate between new job scheduler ids (which may
   * contain any number of colon segments) and legacy repeatable job keys
   * (which always contain 5+ colon segments). Relying purely on segment
   * count is not safe because a user-provided jobSchedulerId may itself
   * contain 5+ colon segments, which would otherwise be misclassified as
   * a legacy repeatable key.
   *
   * We cannot use ZSCORE on the shared `repeat` sorted set because legacy
   * repeatable jobs are stored in the same sorted set and would be reported
   * as schedulers. Instead, we probe the per-id metadata hash (`repeat:<id>`)
   * for the `ic` (iteration count) field, which is written exclusively by
   * `storeJobScheduler` and is never set by the legacy `addRepeatableJob`
   * flow.
   */
  async isJobScheduler(id: string): Promise<boolean> {
    return this.backend.isJobScheduler(id);
  }

  async getScheduler<D = any>(
    id: string,
  ): Promise<JobSchedulerJson<D> | undefined> {
    const [rawJobData, next] = await this.backend.getJobScheduler(id);

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
    const result = await this.backend.getJobSchedulersRange(start, end, asc);

    const jobs = [];
    for (let i = 0; i < result.length; i += 2) {
      jobs.push(this.getSchedulerData<D>(result[i], parseInt(result[i + 1])));
    }
    return (await Promise.all(jobs)).filter(
      (job): job is JobSchedulerJson<D> => !!job,
    );
  }

  async getSchedulersCount(): Promise<number> {
    return this.backend.getJobSchedulersCount();
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
  const interval = CronExpressionParser.parse(pattern, {
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

/**
 * Computes the next execution time (in ms since epoch) for the given repeat
 * options, supporting both `.every` (fixed interval) and `.pattern` (cron)
 * strategies. This is the default repeat strategy used to schedule the next
 * iteration of a job scheduler.
 */
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
  const interval = CronExpressionParser.parse(pattern, {
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
