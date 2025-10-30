/*eslint-env node */
'use strict';

import { QueueBase } from './queue-base';
import { Job } from './job';
import { clientCommandMessageReg, QUEUE_EVENT_SUFFIX } from '../utils';
import { JobState, JobType } from '../types';
import { JobJsonRaw, Metrics, QueueMeta } from '../interfaces';

/**
 * Provides different getters for different aspects of a queue.
 */
export class QueueGetters<JobBase extends Job = Job> extends QueueBase {
  getJob(jobId: string): Promise<JobBase | undefined> {
    return this.Job.fromId(this, jobId) as Promise<JobBase>;
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
        case 'prioritized':
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
      'prioritized',
      'waiting',
      'waiting-children',
    ];
  }

  /**
    Returns the number of jobs waiting to be processed. This includes jobs that are
    "waiting" or "delayed" or "prioritized" or "waiting-children".
  */
  async count(): Promise<number> {
    const count = await this.getJobCountByTypes(
      'waiting',
      'paused',
      'delayed',
      'prioritized',
      'waiting-children',
    );

    return count;
  }

  /**
   * Returns the time to live for a rate limited key in milliseconds.
   * @param maxJobs - max jobs to be considered in rate limit state. If not passed
   * it will return the remaining ttl without considering if max jobs is excedeed.
   * @returns -2 if the key does not exist.
   * -1 if the key exists but has no associated expire.
   * @see {@link https://redis.io/commands/pttl/}
   */
  async getRateLimitTtl(maxJobs?: number): Promise<number> {
    return this.scripts.getRateLimitTtl(maxJobs);
  }

  /**
   * Get jobId that starts debounced state.
   * @deprecated use getDeduplicationJobId method
   *
   * @param id - debounce identifier
   */
  async getDebounceJobId(id: string): Promise<string | null> {
    const client = await this.client;

    return client.get(`${this.keys.de}:${id}`);
  }

  /**
   * Get jobId from deduplicated state.
   *
   * @param id - deduplication identifier
   */
  async getDeduplicationJobId(id: string): Promise<string | null> {
    const client = await this.client;

    return client.get(`${this.keys.de}:${id}`);
  }

  /**
   * Get global concurrency value.
   * Returns null in case no value is set.
   */
  async getGlobalConcurrency(): Promise<number | null> {
    const client = await this.client;
    const concurrency = await client.hget(this.keys.meta, 'concurrency');
    if (concurrency) {
      return Number(concurrency);
    }
    return null;
  }

  /**
   * Get global rate limit values.
   * Returns null in case no value is set.
   */
  async getGlobalRateLimit(): Promise<{
    max: number;
    duration: number;
  } | null> {
    const client = await this.client;
    const [max, duration] = await client.hmget(
      this.keys.meta,
      'max',
      'duration',
    );
    if (max && duration) {
      return {
        max: Number(max),
        duration: Number(duration),
      };
    }
    return null;
  }

  /**
   * Job counts by type
   *
   * Queue#getJobCountByTypes('completed') =\> completed count
   * Queue#getJobCountByTypes('completed,failed') =\> completed + failed count
   * Queue#getJobCountByTypes('completed', 'failed') =\> completed + failed count
   * Queue#getJobCountByTypes('completed', 'waiting', 'failed') =\> completed + waiting + failed count
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

    const responses = await this.scripts.getCounts(currentTypes);

    const counts: { [index: string]: number } = {};
    responses.forEach((res, index) => {
      counts[currentTypes[index]] = res || 0;
    });

    return counts;
  }

  /**
   * Get current job state.
   *
   * @param jobId - job identifier.
   * @returns Returns one of these values:
   * 'completed', 'failed', 'delayed', 'active', 'waiting', 'waiting-children', 'unknown'.
   */
  getJobState(jobId: string): Promise<JobState | 'unknown'> {
    return this.scripts.getState(jobId);
  }

  /**
   * Get global queue configuration.
   *
   * @returns Returns the global queue configuration.
   */
  async getMeta(): Promise<QueueMeta> {
    const client = await this.client;
    const config = await client.hgetall(this.keys.meta);

    const {
      concurrency,
      max,
      duration,
      paused,
      'opts.maxLenEvents': maxLenEvents,
      ...rest
    } = config;

    const parsedConfig: QueueMeta = rest;
    if (concurrency) {
      parsedConfig['concurrency'] = Number(concurrency);
    }

    if (maxLenEvents) {
      parsedConfig['maxLenEvents'] = Number(maxLenEvents);
    }

    if (max) {
      parsedConfig['max'] = Number(max);
    }

    if (duration) {
      parsedConfig['duration'] = Number(duration);
    }

    parsedConfig['paused'] = paused === '1';

    return parsedConfig;
  }

  /**
   * @returns Returns the number of jobs in completed status.
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
   * Returns the number of jobs in prioritized status.
   */
  getPrioritizedCount(): Promise<number> {
    return this.getJobCountByTypes('prioritized');
  }

  /**
   * Returns the number of jobs per priority.
   */
  async getCountsPerPriority(priorities: number[]): Promise<{
    [index: string]: number;
  }> {
    const uniquePriorities = [...new Set(priorities)];
    const responses = await this.scripts.getCountsPerPriority(uniquePriorities);

    const counts: { [index: string]: number } = {};
    responses.forEach((res, index) => {
      counts[`${uniquePriorities[index]}`] = res || 0;
    });

    return counts;
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
  getWaiting(start = 0, end = -1): Promise<JobBase[]> {
    return this.getJobs(['waiting'], start, end, true);
  }

  /**
   * Returns the jobs that are in the "waiting-children" status.
   * I.E. parent jobs that have at least one child that has not completed yet.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   */
  getWaitingChildren(start = 0, end = -1): Promise<JobBase[]> {
    return this.getJobs(['waiting-children'], start, end, true);
  }

  /**
   * Returns the jobs that are in the "active" status.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   */
  getActive(start = 0, end = -1): Promise<JobBase[]> {
    return this.getJobs(['active'], start, end, true);
  }

  /**
   * Returns the jobs that are in the "delayed" status.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   */
  getDelayed(start = 0, end = -1): Promise<JobBase[]> {
    return this.getJobs(['delayed'], start, end, true);
  }

  /**
   * Returns the jobs that are in the "prioritized" status.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   */
  getPrioritized(start = 0, end = -1): Promise<JobBase[]> {
    return this.getJobs(['prioritized'], start, end, true);
  }

  /**
   * Returns the jobs that are in the "completed" status.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   */
  getCompleted(start = 0, end = -1): Promise<JobBase[]> {
    return this.getJobs(['completed'], start, end, false);
  }

  /**
   * Returns the jobs that are in the "failed" status.
   * @param start - zero based index from where to start returning jobs.
   * @param end - zero based index where to stop returning jobs.
   */
  getFailed(start = 0, end = -1): Promise<JobBase[]> {
    return this.getJobs(['failed'], start, end, false);
  }

  /**
   * Returns the qualified job ids and the raw job data (if available) of the
   * children jobs of the given parent job.
   * It is possible to get either the already processed children, in this case
   * an array of qualified job ids and their result values will be returned,
   * or the pending children, in this case an array of qualified job ids will
   * be returned.
   * A qualified job id is a string representing the job id in a given queue,
   * for example: "bull:myqueue:jobid".
   *
   * @param parentId - The id of the parent job
   * @param type - "processed" | "pending"
   * @param opts - Options for the query.
   *
   * @returns an object with the following shape:
   * `{ items: { id: string, v?: any, err?: string } [], jobs: JobJsonRaw[], total: number}`
   */
  async getDependencies(
    parentId: string,
    type: 'processed' | 'pending',
    start: number,
    end: number,
  ): Promise<{
    items: { id: string; v?: any; err?: string }[];
    jobs: JobJsonRaw[];
    total: number;
  }> {
    const key = this.toKey(
      type == 'processed'
        ? `${parentId}:processed`
        : `${parentId}:dependencies`,
    );
    const { items, total, jobs } = await this.scripts.paginate(key, {
      start,
      end,
      fetchJobs: true,
    });
    return {
      items,
      jobs,
      total,
    };
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
  ): Promise<JobBase[]> {
    const currentTypes = this.sanitizeJobTypes(types);

    const jobIds = await this.getRanges(currentTypes, start, end, asc);

    return Promise.all(
      jobIds.map(jobId => this.Job.fromId(this, jobId) as Promise<JobBase>),
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

  private async baseGetClients(matcher: (name: string) => boolean): Promise<
    {
      [index: string]: string;
    }[]
  > {
    const client = await this.client;
    try {
      const clients = (await client.client('LIST')) as string;
      const list = this.parseClientList(clients, matcher);
      return list;
    } catch (err) {
      if (!clientCommandMessageReg.test((<Error>err).message)) {
        throw err;
      }

      return [{ name: 'GCP does not support client list' }];
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
    const unnamedWorkerClientName = `${this.clientName()}`;
    const namedWorkerClientName = `${this.clientName()}:w:`;

    const matcher = (name: string) =>
      name &&
      (name === unnamedWorkerClientName ||
        name.startsWith(namedWorkerClientName));

    return this.baseGetClients(matcher);
  }

  /**
   * Returns the current count of workers for the queue.
   *
   * getWorkersCount(): Promise<number>
   *
   */
  async getWorkersCount(): Promise<number> {
    const workers = await this.getWorkers();
    return workers.length;
  }

  /**
   * Get queue events list related to the queue.
   * Note: GCP does not support SETNAME, so this call will not work
   *
   * @deprecated do not use this method, it will be removed in the future.
   *
   * @returns - Returns an array with queue events info.
   */
  async getQueueEvents(): Promise<
    {
      [index: string]: string;
    }[]
  > {
    const clientName = `${this.clientName()}${QUEUE_EVENT_SUFFIX}`;
    return this.baseGetClients((name: string) => name === clientName);
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
    const [meta, data, count] = await this.scripts.getMetrics(type, start, end);

    return {
      meta: {
        count: parseInt(meta[0] || '0', 10),
        prevTS: parseInt(meta[1] || '0', 10),
        prevCount: parseInt(meta[2] || '0', 10),
      },
      data: data.map(point => +point || 0),
      count,
    };
  }

  private parseClientList(list: string, matcher: (name: string) => boolean) {
    const lines = list.split(/\r?\n/);
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
      if (matcher(name)) {
        client['name'] = this.name;
        client['rawname'] = name;
        clients.push(client);
      }
    });
    return clients;
  }

  /**
   * Export the metrics for the queue in the Prometheus format.
   * Automatically exports all the counts returned by getJobCounts().
   *
   * @returns - Returns a string with the metrics in the Prometheus format.
   *
   * @see {@link https://prometheus.io/docs/instrumenting/exposition_formats/}
   *
   **/
  async exportPrometheusMetrics(
    globalVariables?: Record<string, string>,
  ): Promise<string> {
    const counts = await this.getJobCounts();
    const metrics: string[] = [];

    // Match the test's expected HELP text
    metrics.push(
      '# HELP bullmq_job_count Number of jobs in the queue by state',
    );
    metrics.push('# TYPE bullmq_job_count gauge');

    const variables = !globalVariables
      ? ''
      : Object.keys(globalVariables).reduce(
          (acc, curr) => `${acc}, ${curr}="${globalVariables[curr]}"`,
          '',
        );

    for (const [state, count] of Object.entries(counts)) {
      metrics.push(
        `bullmq_job_count{queue="${this.name}", state="${state}"${variables}} ${count}`,
      );
    }

    return metrics.join('\n');
  }
}
