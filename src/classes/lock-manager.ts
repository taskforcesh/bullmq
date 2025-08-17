import { LockManagerOptions } from '../interfaces';
import { Scripts } from './scripts';
import { QueueBase } from './queue-base';
import { SpanKind, TelemetryAttributes } from '../enums';
import { IoredisListener } from '../interfaces';

export interface LockManagerListener extends IoredisListener {
  /**
   * Listen to 'error' event.
   *
   * This event is triggered when an error occurs during lock operations.
   */
  error: (error: Error) => void;

  /**
   * Listen to 'lockRenewalFailed' event.
   *
   * This event is triggered when lock renewal fails for one or more jobs.
   */
  lockRenewalFailed: (jobIds: string[]) => void;

  /**
   * Listen to 'stalledJobs' event.
   *
   * This event is triggered when stalled jobs are detected and moved back to waiting.
   */
  stalledJobs: (jobIds: string[]) => void;

  /**
   * Listen to 'locksRenewed' event.
   *
   * This event is triggered when locks are successfully renewed.
   */
  locksRenewed: (data: { count: number; jobIds: string[] }) => void;
}

/**
 * Manages lock renewal and stalled job detection for BullMQ workers.
 * This class extracts the lock management logic from the Worker class
 * to provide a cleaner, more maintainable architecture.
 */
export class LockManager extends QueueBase {
  protected scripts: Scripts;
  protected lockRenewalTimer?: NodeJS.Timeout;
  protected stalledJobsTimer?: NodeJS.Timeout;

  // Maps job ids with their timestamps
  protected trackedJobs = new Map<string, { token: string; ts: number }>();
  protected closed = false;

  private stalledCheckStopper?: () => void;
  private paused = false;

  constructor(queueName: string, public opts: LockManagerOptions) {
    super(queueName, opts);
  }

  /**
   * Starts the lock manager timers for lock renewal and stalled job detection.
   * This replaces the existing timer-based approach in the Worker class.
   */
  start(): void {
    if (this.closed) {
      return;
    }

    // Start lock renewal timer if not disabled
    if (!this.opts.skipLockRenewal && this.opts.lockRenewTime > 0) {
      this.startLockExtenderTimer();
    }

    // Start stalled job detection timer if not disabled
    if (!this.opts.skipStalledCheck && this.opts.stalledInterval > 0) {
      this.startStalledCheckTimer();
    }
  }

  private async stalledChecker() {
    while (!(this.closing || this.paused)) {
      try {
        await this.checkConnectionError(() => this.moveStalledJobsToWait());
      } catch (err) {
        this.emit('error', <Error>err);
      }

      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, this.opts.stalledInterval);
        this.stalledCheckStopper = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
    }
  }

  protected async extendLocks(jobIds: string[]) {
    await this.trace<void>(
      SpanKind.INTERNAL,
      'extendLocks',
      this.name,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.WorkerId]: this.opts.workerId,
          [TelemetryAttributes.WorkerName]: this.opts.workerName,
          [TelemetryAttributes.WorkerJobsToExtendLocks]: jobIds,
        });

        try {
          const jobTokens = jobIds.map(
            id => this.trackedJobs.get(id)?.token || '',
          );

          const erroredJobIds = await this.scripts.extendLocks(
            jobIds,
            jobTokens,
            this.opts.lockDuration,
          );

          for (const jobId of erroredJobIds) {
            // TODO: Send signal to process function that the job has been lost.

            this.emit(
              'error',
              new Error(`could not renew lock for job ${jobId}`),
            );
          }
        } catch (err) {
          this.emit('error', <Error>err);
        }
      },
    );
  }

  private startLockExtenderTimer(): void {
    if (!this.opts.skipLockRenewal) {
      clearTimeout(this.lockRenewalTimer);

      if (!this.closed) {
        this.lockRenewalTimer = setTimeout(async () => {
          // Get all the jobs whose locks expire in less than 1/2 of the lockRenewTime
          const now = Date.now();
          const jobsToExtend: string[] = [];

          for (const jobId of this.trackedJobs.keys()) {
            const { ts, token } = this.trackedJobs.get(jobId)!;
            if (!ts) {
              this.trackedJobs.set(jobId, { token, ts: now });
              continue;
            }

            if (ts + this.opts.lockRenewTime / 2 < now) {
              this.trackedJobs.set(jobId, { token, ts: now });
              jobsToExtend.push(jobId);
            }
          }

          try {
            if (jobsToExtend.length) {
              await this.extendLocks(jobsToExtend);
            }
          } catch (err) {
            this.emit('error', <Error>err);
          }

          this.startLockExtenderTimer();
        }, this.opts.lockRenewTime / 2);
      }
    }
  }

  async startStalledCheckTimer(): Promise<void> {
    if (!this.closing) {
      await this.trace<void>(
        SpanKind.INTERNAL,
        'startStalledCheckTimer',
        this.name,
        async span => {
          span?.setAttributes({
            [TelemetryAttributes.WorkerId]: this.opts.workerId,
            [TelemetryAttributes.WorkerName]: this.opts.workerName,
          });

          this.stalledChecker().catch(err => {
            this.emit('error', <Error>err);
          });
        },
      );
    }
  }

  async pauseStalledChecker() {
    this.paused = true;

    await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, this.opts.stalledInterval);
      this.stalledCheckStopper = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  }

  resumeStalledChecker() {
    this.paused = false;
    this.stalledChecker().catch(err => {
      this.emit('error', <Error>err);
    });
  }

  private async moveStalledJobsToWait() {
    await this.trace<void>(
      SpanKind.INTERNAL,
      'moveStalledJobsToWait',
      this.name,
      async span => {
        const stalled = await this.scripts.moveStalledJobsToWait();

        span?.setAttributes({
          [TelemetryAttributes.WorkerId]: this.opts.workerId,
          [TelemetryAttributes.WorkerName]: this.opts.name,
          [TelemetryAttributes.WorkerStalledJobs]: stalled,
        });

        if (stalled.length > 0) {
          this.emit('stalledJobs', stalled);
        }
      },
    );
  }

  /**
   * Stops the lock manager and clears all timers.
   */
  async close(): Promise<void> {
    this.closing = new Promise(resolve => {
      if (this.lockRenewalTimer) {
        clearInterval(this.lockRenewalTimer);
        this.lockRenewalTimer = undefined;
      }

      if (this.stalledCheckStopper) {
        this.stalledCheckStopper();
      }

      this.trackedJobs.clear();

      resolve();
    });

    await this.closing;
  }

  /**
   * Adds a job to be tracked for lock renewal.
   */
  trackJob(jobId: string, token: string, ts: number): void {
    if (!this.closed && jobId) {
      this.trackedJobs.set(jobId, { token, ts });
    }
  }

  /**
   * Removes a job from lock renewal tracking.
   */
  untrackJob(jobId: string): void {
    this.trackedJobs.delete(jobId);
  }

  /**
   * Renews locks for all active jobs.
   * This replaces the extendLocks method in the Worker class.
   */
  protected async renewLocks(): Promise<void> {
    if (this.closed || this.trackedJobs.size === 0) {
      return;
    }

    const jobIds = Array.from(this.trackedJobs.keys());
    const renewedJobIds: string[] = [];
    const failedJobIds: string[] = [];

    // Renew locks for all jobs
    for (const id of jobIds) {
      if (!id) {continue;}

      try {
        const result = await this.scripts.extendLock(
          id,
          this.opts.workerId,
          this.opts.lockDuration,
        );

        if (result === 1) {
          renewedJobIds.push(id);
        } else {
          failedJobIds.push(id);
          // Remove job from tracking if lock renewal failed
          this.untrackJob(id);
        }
      } catch (error) {
        failedJobIds.push(id);
        // Remove job from tracking if lock renewal failed
        this.untrackJob(id);
      }
    }

    // Emit events for monitoring
    if (renewedJobIds.length > 0) {
      this.emit('locksRenewed', {
        count: renewedJobIds.length,
        jobIds: renewedJobIds,
      });
    }

    if (failedJobIds.length > 0) {
      this.emit('lockRenewalFailed', failedJobIds);
    }
  }

  /**
   * Gets the number of jobs currently being tracked.
   */
  getActiveJobCount(): number {
    return this.trackedJobs.size;
  }

  /**
   * Checks if the lock manager is running.
   */
  isRunning(): boolean {
    return (
      !this.closed &&
      (this.lockRenewalTimer !== undefined ||
        this.stalledJobsTimer !== undefined)
    );
  }
}
