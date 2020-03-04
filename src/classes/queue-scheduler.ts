import { QueueSchedulerOptions } from '../interfaces';
import { array2obj, isRedisInstance } from '../utils';
import { QueueBase } from './';
import { Scripts } from './scripts';
import IORedis = require('ioredis');

const MAX_TIMEOUT_MS = Math.pow(2, 31) - 1; // 32 bit signed

/**
 * This class is just used for some automatic bookkeeping of the queue,
 * such as updating the delay set as well as moving stalled jobs back
 * to the waiting list.
 *
 * Jobs are checked for stallness once every "visibility window" seconds.
 * Jobs are then marked as candidates for being stalled, in the next check,
 * the candidates are marked as stalled and moved to wait.
 * Workers need to clean the candidate list with the jobs that they are working
 * on, failing to update the list results in the job ending being stalled.
 *
 * This class requires a dedicated redis connection, and at least one is needed
 * to be running at a given time, otherwise delays, stalled jobs, retries, repeatable
 * jobs, etc, will not work correctly or at all.
 *
 */
export class QueueScheduler extends QueueBase {
  private nextTimestamp = Number.MAX_VALUE;
  private isBlocked = false;

  constructor(
    name: string,
    { connection, ...opts }: QueueSchedulerOptions = {},
  ) {
    super(name, {
      maxStalledCount: 1,
      stalledInterval: 30000,
      ...opts,
      connection: isRedisInstance(connection)
        ? (<IORedis.Redis>connection).duplicate()
        : connection,
    });

    // tslint:disable: no-floating-promises
    this.run();
  }

  private async run() {
    const client = await this.waitUntilReady();

    const key = this.keys.delay;
    const opts = this.opts as QueueSchedulerOptions;
    const delaySet = await this.updateDelaySet(Date.now());

    const [nextTimestamp] = delaySet;
    let streamLastId = delaySet[1] || '0-0';

    if (nextTimestamp) {
      this.nextTimestamp = nextTimestamp;
    }

    while (!this.closing) {
      // Check if at least the min stalled check time has passed.
      await this.moveStalledJobsToWait();

      // Listen to the delay event stream from lastDelayStreamTimestamp
      // Can we use XGROUPS to reduce redundancy?
      const nextDelay = this.nextTimestamp - Date.now();
      const blockTime = Math.round(
        Math.min(opts.stalledInterval, Math.max(nextDelay, 0)),
      );

      const data = await this.readDelayedData(
        client,
        key,
        streamLastId,
        blockTime,
      );

      if (data && data[0]) {
        const stream = data[0];
        const events = stream[1];

        for (let i = 0; i < events.length; i++) {
          streamLastId = events[i][0];
          const args = array2obj(events[i][1]);
          const nextTimestamp: number = parseInt(args.nextTimestamp);

          if (nextTimestamp < this.nextTimestamp) {
            this.nextTimestamp = nextTimestamp;
          }
        }

        //
        // We trim to a length of 100, which should be a very safe value
        // for all kind of scenarios.
        //
        if (!this.closing) {
          await client.xtrim(key, 'MAXLEN', '~', 100);
        }
      }

      const now = Date.now();
      const delay = this.nextTimestamp - now;

      if (delay <= 0) {
        const [nextTimestamp, id] = await this.updateDelaySet(now);
        if (nextTimestamp) {
          this.nextTimestamp = nextTimestamp / 4096;
          streamLastId = id;
        } else {
          this.nextTimestamp = Number.MAX_VALUE;
        }
      }
    }
  }

  private async readDelayedData(
    client: IORedis.Redis,
    key: string,
    streamLastId: string,
    blockTime: number,
  ) {
    if (!this.closing) {
      let data;
      if (blockTime) {
        try {
          this.isBlocked = true;
          data = await client.xread(
            'BLOCK',
            blockTime,
            'STREAMS',
            key,
            streamLastId,
          );
        } catch (err) {
          // We can ignore closed connection errors
          if (err.message !== 'Connection is closed.') {
            throw err;
          }
        } finally {
          this.isBlocked = false;
        }
      } else {
        data = await client.xread('STREAMS', key, streamLastId);
      }
      return data;
    }
  }

  private async updateDelaySet(timestamp: number) {
    if (!this.closing) {
      return Scripts.updateDelaySet(this, timestamp);
    }
    return [0, 0];
  }

  private async moveStalledJobsToWait() {
    if (!this.closing) {
      const [failed, stalled] = await Scripts.moveStalledJobsToWait(this);

      failed.forEach((jobId: string) =>
        this.emit(
          'failed',
          jobId,
          new Error('job stalled more than allowable limit'),
          'active',
        ),
      );
      stalled.forEach((jobId: string) => this.emit('stalled', jobId, 'active'));
    }
  }

  async close() {
    if (this.closing) {
      return this.closing;
    }
    if (this.isBlocked) {
      this.closing = this.disconnect();
    } else {
      this.closing = super.close();
    }
    return this.closing;
  }
}
