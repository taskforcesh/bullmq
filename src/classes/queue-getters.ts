/*eslint-env node */
'use strict';

import { QueueBase } from './queue-base';
import { Job } from './job';
import { clientCommandMessageReg } from './worker';

export class QueueGetters extends QueueBase {
  getJob(jobId: string): Promise<Job | undefined> {
    return Job.fromId(this, jobId);
  }

  private commandByType(
    types: string[],
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
          return callback(key, count ? 'zcard' : 'zrange');
        case 'active':
        case 'wait':
        case 'paused':
          return callback(key, count ? 'llen' : 'lrange');
      }
    });
  }

  /**
    Returns the number of jobs waiting to be processed.
  */
  count() {
    return this.getJobCountByTypes('waiting', 'paused', 'delayed');
  }

  // Job counts by type
  // Queue#getJobCountByTypes('completed') => completed count
  // Queue#getJobCountByTypes('completed,failed') => completed + failed count
  // Queue#getJobCountByTypes('completed', 'failed') => completed + failed count
  // Queue#getJobCountByTypes('completed', 'waiting', 'failed') => completed + waiting + failed count
  async getJobCountByTypes(...types: string[]) {
    const result = await this.getJobCounts(...types);
    return Object.values(result).reduce((sum, count) => sum + count);
  }

  /**
   * Returns the job counts for each type specified or every list/set in the queue by default.
   *
   */
  async getJobCounts(...types: string[]) {
    const client = await this.client;
    const multi = client.multi();

    this.commandByType(types, true, function(key, command) {
      (<any>multi)[command](key);
    });

    const res = await multi.exec();
    const counts: { [index: string]: number } = {};
    res.forEach((res: number[], index: number) => {
      counts[types[index]] = res[1] || 0;
    });
    return counts;
  }

  getCompletedCount() {
    return this.getJobCountByTypes('completed');
  }

  getFailedCount() {
    return this.getJobCountByTypes('failed');
  }

  getDelayedCount() {
    return this.getJobCountByTypes('delayed');
  }

  getActiveCount() {
    return this.getJobCountByTypes('active');
  }

  getWaitingCount() {
    return this.getJobCountByTypes('waiting', 'paused');
  }

  getWaiting(start = 0, end = 1) {
    return this.getJobs(['waiting'], start, end, true);
  }

  getActive(start = 0, end = 1) {
    return this.getJobs(['active'], start, end, true);
  }

  getDelayed(start = 0, end = 1) {
    return this.getJobs(['delayed'], start, end, true);
  }

  getCompleted(start = 0, end = 1) {
    return this.getJobs(['completed'], start, end, false);
  }

  getFailed(start = 0, end = 1) {
    return this.getJobs(['failed'], start, end, false);
  }

  async getRanges(types: string[], start = 0, end = 1, asc = false) {
    const client = await this.client;
    const multi = client.multi();
    const multiCommands: string[] = [];

    this.commandByType(types, false, (key, command) => {
      switch (command) {
        case 'lrange':
          if (asc) {
            multiCommands.push('lrange');
            multi.lrange(key, -(end + 1), -(start + 1));
          } else {
            multi.lrange(key, start, end);
          }
          break;
        case 'zrange':
          multiCommands.push('zrange');
          if (asc) {
            multi.zrange(key, start, end);
          } else {
            multi.zrevrange(key, start, end);
          }
          break;
      }
    });

    const responses = await multi.exec();
    let results: any[] = [];

    responses.forEach((response: any[], index: number) => {
      const result = response[1] || [];

      if (asc && multiCommands[index] === 'lrange') {
        results = results.concat(result.reverse());
      } else {
        results = results.concat(result);
      }
    });
    return results;
  }

  async getJobs(types: string[] | string, start = 0, end = -1, asc = false) {
    types = Array.isArray(types) ? types : [types];

    if (types.indexOf('waiting') !== -1) {
      types = types.concat(['paused']);
    }
    const jobIds = await this.getRanges(types, start, end, asc);

    return Promise.all(jobIds.map(jobId => Job.fromId(this, jobId)));
  }

  async getJobLogs(jobId: string, start = 0, end = -1) {
    const client = await this.client;
    const multi = client.multi();

    const logsKey = this.toKey(jobId + ':logs');
    multi.lrange(logsKey, -(end + 1), -(start + 1));
    multi.llen(logsKey);
    return multi.exec().then(result => ({
      logs: result[0][1],
      count: result[1][1],
    }));
  }

  async getWorkers() {
    const client = await this.client;
    const clients = await client.client('list');
    try {
      const list = await this.parseClientList(clients);
      return list;
    } catch (err) {
      if (!clientCommandMessageReg.test(err.message)) {
        throw err;
      }
    }
  }

  private parseClientList(list: string) {
    const lines = list.split('\n');
    const clients: { [index: string]: string }[] = [];

    lines.forEach((line: string) => {
      const client: { [index: string]: string } = {};
      const keyValues = line.split(' ');
      keyValues.forEach(function(keyValue) {
        const index = keyValue.indexOf('=');
        const key = keyValue.substring(0, index);
        const value = keyValue.substring(index + 1);
        client[key] = value;
      });
      const name = client['name'];
      if (name && name.startsWith(this.clientName())) {
        client['name'] = this.name;
        clients.push(client);
      }
    });
    return clients;
  }
}
