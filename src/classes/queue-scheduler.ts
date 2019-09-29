import { QueueSchedulerOptions } from '../interfaces';
import { array2obj } from '../utils';
import { QueueBase } from './';
import { Scripts } from './scripts';

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

  constructor(protected name: string, opts: QueueSchedulerOptions = {}) {
    super(name, { maxStalledCount: 1, stalledInterval: 30000, ...opts });

    // tslint:disable: no-floating-promises
    this.run();
  }

  private async run() {
    await this.waitUntilReady();

    const key = this.keys.delay;
    const opts = this.opts as QueueSchedulerOptions;
    const delaySet = await Scripts.updateDelaySet(this, Date.now());

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

      let data;
      if (blockTime) {
        data = await this.client.xread(
          'BLOCK',
          blockTime,
          'STREAMS',
          key,
          streamLastId,
        );
      } else {
        data = await this.client.xread('STREAMS', key, streamLastId);
      }

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
        this.client.xtrim(key, 'MAXLEN', '~', 100);
      }

      const now = Date.now();
      const delay = this.nextTimestamp - now;

      if (delay <= 0) {
        const [nextTimestamp, id] = await Scripts.updateDelaySet(this, now);
        if (nextTimestamp) {
          this.nextTimestamp = nextTimestamp / 4096;
          streamLastId = id;
        } else {
          this.nextTimestamp = Number.MAX_VALUE;
        }
      }
    }
  }

  private async moveStalledJobsToWait() {
    if (this.closing) {
      return;
    }

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
