/*eslint-env node */
'use strict';

import { QueueBase } from './queue-base';
import { Job } from './job';
import {
  clientCommandMessageReg,
  QUEUE_EVENT_SUFFIX,
  WORKER_SUFFIX,
} from '../utils';
import { JobType } from '../types';
import { Metrics } from '../interfaces';

/**
 *
 * @class QueueGetters
 * @extends QueueBase
 *
 * @description Provides different getters for different aspects of a queue.
 */
export class QueueGetters<
  DataType,
  ResultType,
  NameType extends string,
> extends QueueBase {
  getJob(
    jobId: string,
  ): Promise<Job<DataType, ResultType, NameType> | undefined> {
    return this.Job.fromId(this, jobId) as Promise<
      Job<DataType, ResultType, NameType>
    >;
  }

  private commandByType(
    types: JobType[],
    count: boolean,
    callback: (key: string, dataType: string) => void,
  ) {
    return types.map((type: string) => {
      type = type === 'waiting' ? 'wait' : type; // alias

      const key = this.toKey(type);

      switch (type) {
        case 'completed':
        case 'failed':
        case 'delayed':
        case 'repeat':
        case 'waiting-children':
          return callback(key, count ? 'zcard' : 'zrange');
        case 'active':
        case 'wait':
        case 'paused':
          return callback(key, count ? 'llen' : 'lrange');
      }
    });
  }

  /**
   * Helper to easily extend Job class calls.
   */
  protected get Job(): typeof Job {
    return Job;
  }

  private sanitizeJobTypes(types: JobType[] | JobType | undefined): JobType[] {
    const currentTypes = typeof types === 'string' ? [types] : types;

    if (Array.isArray(currentTypes) && currentTypes.length > 0) {
      const sanitizedTypes = [...currentTypes];

      if (sanitizedTypes.indexOf('waiting') !== -1) {
        sanitizedTypes.push('paused');
      }

      return [...new Set(sanitizedTypes)];
    }

    return [
      'active',
      'completed',
      'delayed',
      'failed',
      'paused',
      'waiting',
      'waiting-children',
    ];
  }

  /**
    Returns the number of jobs waiting to be processed. This includes jobs that are "waiting" or "delayed".
  */
  async count(): Promise<number> {
    const count = await this.getJobCountByTypes(
      'waiting',
      'paused',
      'delayed',
      'waiting-children',
    );

    if (await this.hasDelayedMarker('wait', 'paused')) {
      return count - 1;
    }

    return count;
  }

  private async hasDelayedMarker(
    ...types: ('wait' | 'paused')[]
  ): Promise<boolean> {
    const client = await this.client;

    const promises = [];
    if (types.includes('wait')) {
      promises.push(client.lindex(this.toKey('wait'), 0));
    }

    if (types.includes('paused')) {
      promises.push(client.lindex(this.toKey('paused'), 0));
    }

    return (await Promise.all(promises)).some(
      value => value === '0' || value?.startsWith('0:'),
    );
  }

  /**
   * Job counts by type
   *
   * Queue#getJobCountByTypes('completed') => completed count
   * Queue#getJobCountByTypes('completed,failed') => completed + failed count
   * Queue#getJobCountByTypes('completed', 'failed') => completed + failed count
   * Queue#getJobCountByTypes('completed', 'waiting', 'failed') => completed + waiting + failed count
   */
  async getJobCountByTypes(...types: JobType[]): Promise<number> {
    const result = await this.getJobCounts(...types);
    return Object.values(result).reduce((sum, count) => sum + count, 0);
  }

  /**
   * Returns the job counts for each type specified or every list/set in the queue by default.
   *
   * @returns An object, key (type) and value (count)
   */
  async getJobCounts(...types: JobType[]): Promise<{
    [index: string]: number;
  }> {
    const currentTypes = this.sanitizeJobTypes(types);

    const client = await this.client;
    const multi = client.multi();

    this.commandByType(currentTypes, true, function (key, command) {
      (<any>multi)[command](key);
    });

    const res = (await multi.exec()) as [Error, number][];
    const counts: { [index: string]: number } = {};
    res.forEach((res, index) => {
      counts[currentTypes[index]] = res[1] || 0;
    });

    if (counts['wait'] > 0) {
      if (await this.hasDelayedMarker('wait')) {
        counts['wait']--;
      }
    }

    if (counts['paused'] > 0) {
      if (await this.hasDelayedMarker('paused')) {
        counts['paused']--;
      }
    }

    return counts;
  }

  /**
   * Returns the number of jobs in completed status.
   */
  getCompletedCount(): Promise<number> {
    return this.getJobCountByTypes('completed');
  }

  /**
   * Returns the number of jobs in failed status.
   */
  getFailedCount(): Promise<number> {
    return this.getJobCountByTypes('failed');
  }

  /**
   * Returns the number of jobs in delayed status.
   */
  getDelayedCount(): Promise<number> {
    return this.getJobCountByTypes('delayed');
  }

  /**
   * Returns the number of jobs in active status.
   */
  getActiveCount(): Promise<number> {
    return this.getJobCountByTypes('active');
  }

  /**
   * Returns the number of jobs in waiting or paused statuses.
   */
  getWaitingCount(): Promise<number> {
    return this.getJobCountByTypes('waiting');
  }

  /**
   * Returns the number of jobs in waiting-children status.
   */
  getWaitingChildrenCount(): Promise<number> {
    return this.getJobCountByTypes('waiting-children');
  }

  /**
   * Returns the jobs that are in the "waiting" status.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   */
  getWaiting(
    start = 0,
    end = -1,
  ): Promise<Job<DataType, ResultType, NameType>[]> {
    return this.getJobs(['waiting'], start, end, true);
  }

  /**
   * Returns the jobs that are in the "waiting" status.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   */
  getWaitingChildren(
    start = 0,
    end = -1,
  ): Promise<Job<DataType, ResultType, NameType>[]> {
    return this.getJobs(['waiting-children'], start, end, true);
  }

  /**
   * Returns the jobs that are in the "active" status.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   */
  getActive(
    start = 0,
    end = -1,
  ): Promise<Job<DataType, ResultType, NameType>[]> {
    return this.getJobs(['active'], start, end, true);
  }

  /**
   * Returns the jobs that are in the "delayed" status.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   */
  getDelayed(
    start = 0,
    end = -1,
  ): Promise<Job<DataType, ResultType, NameType>[]> {
    return this.getJobs(['delayed'], start, end, true);
  }

  /**
   * Returns the jobs that are in the "completed" status.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   */
  getCompleted(
    start = 0,
    end = -1,
  ): Promise<Job<DataType, ResultType, NameType>[]> {
    return this.getJobs(['completed'], start, end, false);
  }

  /**
   * Returns the jobs that are in the "failed" status.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   */
  getFailed(
    start = 0,
    end = -1,
  ): Promise<Job<DataType, ResultType, NameType>[]> {
    return this.getJobs(['failed'], start, end, false);
  }

  async getRanges(
    types: JobType[],
    start = 0,
    end = 1,
    asc = false,
  ): Promise<string[]> {
    const multiCommands: string[] = [];

    this.commandByType(types, false, (key, command) => {
      switch (command) {
        case 'lrange':
          multiCommands.push('lrange');
          break;
        case 'zrange':
          multiCommands.push('zrange');
          break;
      }
    });

    const responses = await this.scripts.getRanges(types, start, end, asc);

    let results: string[] = [];

    responses.forEach((response: string[], index: number) => {
      const result = response || [];

      if (asc && multiCommands[index] === 'lrange') {
        results = results.concat(result.reverse());
      } else {
        results = results.concat(result);
      }
    });

    return [...new Set(results)];
  }

  /**
   * Returns the jobs that are on the given statuses (note that JobType is synonym for job status)
   * @param types - the statuses of the jobs to return.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   * @param asc - if true, the jobs will be returned in ascending order.
   */
  async getJobs(
    types?: JobType[] | JobType,
    start = 0,
    end = -1,
    asc = false,
  ): Promise<Job<DataType, ResultType, NameType>[]> {
    types = this.sanitizeJobTypes(types);

    const jobIds = await this.getRanges(types, start, end, asc);

    return Promise.all(
      jobIds.map(
        jobId =>
          this.Job.fromId(this, jobId) as Promise<
            Job<DataType, ResultType, NameType>
          >,
      ),
    );
  }

  /**
   * Returns the logs for a given Job.
   * @param jobId - the id of the job to get the logs for.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   * @param asc - if true, the jobs will be returned in ascending order.
   */
  async getJobLogs(
    jobId: string,
    start = 0,
    end = -1,
    asc = true,
  ): Promise<{ logs: string[]; count: number }> {
    const client = await this.client;
    const multi = client.multi();

    const logsKey = this.toKey(jobId + ':logs');
    if (asc) {
      multi.lrange(logsKey, start, end);
    } else {
      multi.lrange(logsKey, -(end + 1), -(start + 1));
    }
    multi.llen(logsKey);
    const result = (await multi.exec()) as [[Error, [string]], [Error, number]];
    if (!asc) {
      result[0][1].reverse();
    }
    return {
      logs: result[0][1],
      count: result[1][1],
    };
  }

  private async baseGetClients(suffix: string): Promise<
    {
      [index: string]: string;
    }[]
  > {
    const client = await this.client;
    const clients = (await client.client('LIST')) as string;
    try {
      const list = this.parseClientList(clients, suffix);
      return list;
    } catch (err) {
      if (!clientCommandMessageReg.test((<Error>err).message)) {
        throw err;
      }
    }
  }

  /**
   * Get the worker list related to the queue. i.e. all the known
   * workers that are available to process jobs for this queue.
   * Note: GCP does not support SETNAME, so this call will not work
   *
   * @returns - Returns an array with workers info.
   */
  getWorkers(): Promise<
    {
      [index: string]: string;
    }[]
  > {
    return this.baseGetClients(WORKER_SUFFIX);
  }

  /**
   * Get queue events list related to the queue.
   * Note: GCP does not support SETNAME, so this call will not work
   *
   * @returns - Returns an array with queue events info.
   */
  async getQueueEvents(): Promise<
    {
      [index: string]: string;
    }[]
  > {
    return this.baseGetClients(QUEUE_EVENT_SUFFIX);
  }

  /**
   * Get queue metrics related to the queue.
   *
   * This method returns the gathered metrics for the queue.
   * The metrics are represented as an array of job counts
   * per unit of time (1 minute).
   *
   * @param start - Start point of the metrics, where 0
   * is the newest point to be returned.
   * @param end - End point of the metrics, where -1 is the
   * oldest point to be returned.
   *
   * @returns - Returns an object with queue metrics.
   */
  async getMetrics(
    type: 'completed' | 'failed',
    start = 0,
    end = -1,
  ): Promise<Metrics> {
    const client = await this.client;
    const metricsKey = this.toKey(`metrics:${type}`);
    const dataKey = `${metricsKey}:data`;

    const multi = client.multi();
    multi.hmget(metricsKey, 'count', 'prevTS', 'prevCount');
    multi.lrange(dataKey, start, end);
    multi.llen(dataKey);

    const [hmget, range, len] = (await multi.exec()) as [
      [Error, [string, string, string]],
      [Error, []],
      [Error, number],
    ];
    const [err, [count, prevTS, prevCount]] = hmget;
    const [err2, data] = range;
    const [err3, numPoints] = len;
    if (err || err2) {
      throw err || err2 || err3;
    }

    return {
      meta: {
        count: parseInt(count || '0', 10),
        prevTS: parseInt(prevTS || '0', 10),
        prevCount: parseInt(prevCount || '0', 10),
      },
      data,
      count: numPoints,
    };
  }

  private parseClientList(list: string, suffix = '') {
    const lines = list.split('\n');
    const clients: { [index: string]: string }[] = [];

    lines.forEach((line: string) => {
      const client: { [index: string]: string } = {};
      const keyValues = line.split(' ');
      keyValues.forEach(function (keyValue) {
        const index = keyValue.indexOf('=');
        const key = keyValue.substring(0, index);
        const value = keyValue.substring(index + 1);
        client[key] = value;
      });
      const name = client['name'];
      if (name && name === `${this.clientName()}${suffix ? `${suffix}` : ''}`) {
        client['name'] = this.name;
        clients.push(client);
      }
    });
    return clients;
  }
}
