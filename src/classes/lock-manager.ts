import { SpanKind, TelemetryAttributes } from '../enums';
import { Span } from '../interfaces';

export interface LockManagerListener {
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
   * Listen to 'locksRenewed' event.
   *
   * This event is triggered when locks are successfully renewed.
   */
  locksRenewed: (data: { count: number; jobIds: string[] }) => void;
}

export interface LockManagerOptions {
  lockRenewTime: number;
  lockDuration: number;
  workerId: string;
  workerName?: string;
}

/**
 * Minimal interface that LockManager needs from Worker.
 * This allows LockManager to access worker methods without inheriting from QueueBase.
 */
export interface LockManagerWorkerContext {
  /**
   * Extends locks for multiple jobs.
   */
  extendJobLocks(
    jobIds: string[],
    tokens: string[],
    duration: number,
  ): Promise<string[]>;

  /**
   * Emits events to worker listeners.
   */
  emit(event: string | symbol, ...args: any[]): boolean;

  /**
   * Wraps code with telemetry tracing.
   */
  trace<T>(
    spanKind: any,
    operation: string,
    destination: string,
    callback: (span?: Span) => Promise<T> | T,
  ): Promise<T> | T;

  /**
   * Queue name for telemetry.
   */
  name: string;
}

/**
 * Manages lock renewal for BullMQ workers.
 * It periodically extends locks for active jobs to prevent them from being
 * considered stalled by other workers.
 */
export class LockManager {
  protected lockRenewalTimer?: NodeJS.Timeout;

  // Maps job ids with their timestamps
  protected trackedJobs = new Map<string, { token: string; ts: number }>();
  protected closed = false;

  constructor(
    private worker: LockManagerWorkerContext,
    private opts: LockManagerOptions,
  ) {}

  /**
   * Starts the lock manager timers for lock renewal.
   */
  start(): void {
    if (this.closed) {
      return;
    }

    // Start lock renewal timer if not disabled
    if (this.opts.lockRenewTime > 0) {
      this.startLockExtenderTimer();
    }
  }

  protected async extendLocks(jobIds: string[]): Promise<void> {
    await this.worker.trace<void>(
      SpanKind.INTERNAL,
      'extendLocks',
      this.worker.name,
      async (span?: Span) => {
        span?.setAttributes({
          [TelemetryAttributes.WorkerId]: this.opts.workerId,
          [TelemetryAttributes.WorkerName]: this.opts.workerName,
          [TelemetryAttributes.WorkerJobsToExtendLocks]: jobIds,
        });

        try {
          const jobTokens = jobIds.map(
            id => this.trackedJobs.get(id)?.token || '',
          );

          const erroredJobIds = await this.worker.extendJobLocks(
            jobIds,
            jobTokens,
            this.opts.lockDuration,
          );

          if (erroredJobIds.length > 0) {
            this.worker.emit('lockRenewalFailed', erroredJobIds);

            for (const jobId of erroredJobIds) {
              // TODO: Send signal to process function that the job has been lost.

              this.worker.emit(
                'error',
                new Error(`could not renew lock for job ${jobId}`),
              );
            }
          }

          const succeededJobIds = jobIds.filter(
            id => !erroredJobIds.includes(id),
          );

          if (succeededJobIds.length > 0) {
            this.worker.emit('locksRenewed', {
              count: succeededJobIds.length,
              jobIds: succeededJobIds,
            });
          }
        } catch (err) {
          this.worker.emit('error', err as Error);
        }
      },
    );
  }

  private startLockExtenderTimer(): void {
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
          this.worker.emit('error', err as Error);
        }

        this.startLockExtenderTimer();
      }, this.opts.lockRenewTime / 2);
    }
  }

  /**
   * Stops the lock manager and clears all timers.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    if (this.lockRenewalTimer) {
      clearTimeout(this.lockRenewalTimer);
      this.lockRenewalTimer = undefined;
    }

    this.trackedJobs.clear();
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
   * Gets the number of jobs currently being tracked.
   */
  getActiveJobCount(): number {
    return this.trackedJobs.size;
  }

  /**
   * Checks if the lock manager is running.
   */
  isRunning(): boolean {
    return !this.closed && this.lockRenewalTimer !== undefined;
  }
}
