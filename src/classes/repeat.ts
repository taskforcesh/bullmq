import { createHash } from 'crypto';
import { JobsOptions, RepeatOptions } from '../interfaces';
import { Job, QueueBase } from './';

const parser = require('cron-parser');

export class Repeat extends QueueBase {
  async addNextRepeatableJob(
    name: string,
    data: any,
    opts: JobsOptions,
    skipCheckExists?: boolean,
  ) {
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
      const repeatJobKey = getRepeatKey(name, repeatOpts);

      let repeatableExists = true;

      if (!skipCheckExists) {
        // Check that the repeatable job hasn't been removed
        // TODO: a lua script would be better here
        const client = await this.client;
        repeatableExists = !!(await client.zscore(
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
    opts: JobsOptions,
    data: any,
    currentCount: number,
  ) {
    const client = await this.client;

    //
    // Generate unique job id for this iteration.
    //
    const jobId = getRepeatJobId(name, nextMillis, md5(repeatJobKey));
    const now = Date.now();
    const delay = nextMillis - now;

    const mergedOpts = {
      ...opts,
      jobId,
      delay: delay < 0 ? 0 : delay,
      timestamp: now,
      prevMillis: nextMillis,
    };

    mergedOpts.repeat = { ...opts.repeat, count: currentCount };

    await client.zadd(this.keys.repeat, nextMillis.toString(), repeatJobKey);

    return Job.create(this, name, data, mergedOpts);
  }

  async removeRepeatable(name: string, repeat: RepeatOptions, jobId?: string) {
    const client = await this.client;

    const repeatJobKey = getRepeatKey(name, repeat);
    const repeatJobId = getRepeatJobId(name, '', md5(repeatJobKey));
    const queueKey = this.keys[''];

    return (<any>client).removeRepeatable(
      this.keys.repeat,
      this.keys.delayed,
      repeatJobId,
      repeatJobKey,
      queueKey,
    );
  }

  async removeRepeatableByKey(repeatJobKey: string) {
    const client = await this.client;

    const data = this._keyToData(repeatJobKey);
    const queueKey = this.keys[''];

    return (<any>client).removeRepeatable(
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
      key,
      name: data[0],
      id: data[1] || null,
      endDate: parseInt(data[2]) || null,
      tz: data[3] || null,
      cron: data[4],
    };
  }

  async getRepeatableJobs(start = 0, end = -1, asc = false) {
    const client = await this.client;

    const key = this.keys.repeat;
    const result = asc
      ? await client.zrange(key, start, end, 'WITHSCORES')
      : await client.zrevrange(key, start, end, 'WITHSCORES');

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
    const client = await this.client;
    return client.zcard(this.toKey('repeat'));
  }
}

function getRepeatJobId(
  name: string,
  nextMillis: number | string,
  namespace: string,
) {
  return `repeat:${name}:${namespace}:${nextMillis}`;
}

function getRepeatKey(name: string, repeat: RepeatOptions) {
  const endDate = repeat.endDate ? new Date(repeat.endDate).getTime() : '';
  const tz = repeat.tz || '';
  const suffix = (repeat.cron ? repeat.cron : String(repeat.every)) || '';

  return `${name}::${endDate}:${tz}:${suffix}`;
}

function getNextMillis(millis: number, opts: RepeatOptions) {
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
