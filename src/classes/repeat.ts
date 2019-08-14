import { QueueBase } from './queue-base';
import { Job } from './job';

import { createHash } from 'crypto';
import { RepeatOpts } from '@src/interfaces/repeat-opts';
import { JobsOpts } from '@src/interfaces';
const parser = require('cron-parser');

export class Repeat extends QueueBase {
  async addNextRepeatableJob(
    name: string,
    data: any,
    opts: JobsOpts,
    skipCheckExists?: boolean,
  ) {
    let jobId;

    await this.waitUntilReady();

    const repeatOpts = { ...opts.repeat };

    const prevMillis = repeatOpts.prevMillis || 0;

    const currentCount = repeatOpts.count ? repeatOpts.count + 1 : 1;

    if (
      typeof repeatOpts.limit !== 'undefined' &&
      currentCount > repeatOpts.limit
    ) {
      return;
    }

    let now = Date.now();
    now = prevMillis < now ? now : prevMillis;

    const nextMillis = getNextMillis(now, repeatOpts);

    if (nextMillis) {
      jobId = opts.jobId ? opts.jobId + ':' : ':';

      const repeatJobKey = getRepeatKey(name, repeatOpts, jobId);

      let repeatableExists = true;

      if (!skipCheckExists) {
        // Check that the repeatable job hasn't been removed
        // TODO: a lua script would be better here
        repeatableExists = !!(await this.client.zscore(
          this.keys.repeat,
          repeatJobKey,
        ));
      }

      // The job could have been deleted since this check
      if (repeatableExists) {
        return this.createNextJob(
          name,
          nextMillis,
          repeatJobKey,
          jobId,
          { ...opts, repeat: repeatOpts },
          data,
          currentCount,
        );
      }
    }
  }

  private async createNextJob(
    name: string,
    nextMillis: number,
    repeatJobKey: string,
    jobId: string,
    opts: JobsOpts,
    data: any,
    currentCount: number,
  ) {
    //
    // Generate unique job id for this iteration.
    //
    const customId = getRepeatJobId(name, jobId, nextMillis, md5(repeatJobKey));
    const now = Date.now();
    const delay = nextMillis - now;

    const mergedOpts = {
      ...opts,
      delay: delay < 0 ? 0 : delay,
      timestamp: now,
      prevMillis: nextMillis,
    };

    mergedOpts.repeat = { ...opts.repeat, count: currentCount };

    await this.client.zadd(
      this.keys.repeat,
      nextMillis.toString(),
      repeatJobKey,
    );

    return Job.create(this, name, data, mergedOpts, customId);
  }

  async removeRepeatable(name: string, repeat: RepeatOpts, jobId?: string) {
    await this.waitUntilReady();

    jobId = jobId ? jobId + ':' : ':';
    const repeatJobKey = getRepeatKey(name, repeat, jobId);
    const repeatJobId = getRepeatJobId(name, jobId, '', md5(repeatJobKey));
    const queueKey = this.keys[''];

    return (<any>this.client).removeRepeatable(
      this.keys.repeat,
      this.keys.delayed,
      repeatJobId,
      repeatJobKey,
      queueKey,
    );
  }

  async removeRepeatableByKey(repeatJobKey: string) {
    await this.waitUntilReady();

    const data = this._keyToData(repeatJobKey);
    const queueKey = this.keys[''];

    return (<any>this.client).removeRepeatable(
      this.keys.repeat,
      this.keys.delayed,
      data.id,
      repeatJobKey,
      queueKey,
    );
  }

  _keyToData(key: string) {
    const data = key.split(':');

    return {
      key: key,
      name: data[0],
      id: data[1] || null,
      endDate: parseInt(data[2]) || null,
      tz: data[3] || null,
      cron: data[4],
    };
  }

  async getRepeatableJobs(start = 0, end = -1, asc = false) {
    await this.waitUntilReady();

    const key = this.keys.repeat;
    const result = asc
      ? await this.client.zrange(key, start, end, 'WITHSCORES')
      : await this.client.zrevrange(key, start, end, 'WITHSCORES');

    const jobs = [];
    for (let i = 0; i < result.length; i += 2) {
      const data = result[i].split(':');
      jobs.push({
        key: result[i],
        name: data[0],
        id: data[1] || null,
        endDate: parseInt(data[2]) || null,
        tz: data[3] || null,
        cron: data[4],
        next: parseInt(result[i + 1]),
      });
    }
    return jobs;
  }

  async getRepeatableCount() {
    await this.waitUntilReady();
    return this.client.zcard(this.toKey('repeat'));
  }
}

function getRepeatJobId(
  name: string,
  jobId: string,
  nextMillis: number | string,
  namespace: string,
) {
  return 'repeat:' + md5(name + jobId + namespace) + ':' + nextMillis;
}

function getRepeatKey(name: string, repeat: RepeatOpts, jobId: string) {
  const endDate = repeat.endDate
    ? new Date(repeat.endDate).getTime() + ':'
    : ':';
  const tz = repeat.tz ? repeat.tz + ':' : ':';
  const suffix = repeat.cron ? tz + repeat.cron : String(repeat.every);

  return name + ':' + jobId + endDate + suffix;
}

function getNextMillis(millis: number, opts: RepeatOpts) {
  if (opts.cron && opts.every) {
    throw new Error(
      'Both .cron and .every options are defined for this repeatable job',
    );
  }

  if (opts.every) {
    return Math.floor(millis / opts.every) * opts.every + opts.every;
  }

  const currentDate =
    opts.startDate && new Date(opts.startDate) > new Date(millis)
      ? new Date(opts.startDate)
      : new Date(millis);
  const interval = parser.parseExpression(opts.cron, {
    ...opts,
    currentDate,
  });

  try {
    return interval.next().getTime();
  } catch (e) {
    // Ignore error
  }
}

function md5(str: string) {
  return createHash('md5')
    .update(str)
    .digest('hex');
}
