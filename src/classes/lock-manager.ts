import { AbortController } from 'node-abort-controller';
import { SpanKind, TelemetryAttributes } from '../enums';
import { LockManagerWorkerContext, Span } from '../interfaces';

export interface LockManagerOptions {
  lockRenewTime: number;
  lockDuration: number;
  workerId: string;
  workerName?: string;
}

/**
 * Manages lock renewal for BullMQ workers.
 * It periodically extends locks for active jobs to prevent them from being
 * considered stalled by other workers.
 */
export class LockManager {
  protected lockRenewalTimer?: NodeJS.Timeout;

  // Maps job ids with their tokens, timestamps, and abort controllers
  protected trackedJobs = new Map<
    string,
    { token: string; ts: number; abortController?: AbortController }
  >();
  protected closed = false;

  constructor(
    protected worker: LockManagerWorkerContext,
    protected opts: LockManagerOptions,
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
          [TelemetryAttributes.WorkerJobsToExtendLocks_]: jobIds,
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
          const tracked = this.trackedJobs.get(jobId)!;
          const { ts, token, abortController } = tracked;
          if (!ts) {
            this.trackedJobs.set(jobId, { token, ts: now, abortController });
            continue;
          }

          if (ts + this.opts.lockRenewTime / 2 < now) {
            this.trackedJobs.set(jobId, { token, ts: now, abortController });
            jobsToExtend.push(jobId);
          }
        }

        if (jobsToExtend.length) {
          await this.extendLocks(jobsToExtend);
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
   * Returns an AbortController if shouldCreateController is true, undefined otherwise.
   */
  trackJob(
    jobId: string,
    token: string,
    ts: number,
    shouldCreateController = false,
  ): AbortController | undefined {
    const abortController = shouldCreateController
      ? new AbortController()
      : undefined;
    if (!this.closed && jobId) {
      this.trackedJobs.set(jobId, { token, ts, abortController });
    }
    return abortController;
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

  /**
   * Cancels a specific job by aborting its signal.
   * @param jobId - The ID of the job to cancel
   * @param reason - Optional reason for the cancellation
   * @returns true if the job was found and cancelled, false otherwise
   */
  cancelJob(jobId: string, reason?: string): boolean {
    const tracked = this.trackedJobs.get(jobId);
    if (tracked?.abortController) {
      tracked.abortController.abort(reason);
      return true;
    }
    return false;
  }

  /**
   * Cancels all tracked jobs by aborting their signals.
   * @param reason - Optional reason for the cancellation
   */
  cancelAllJobs(reason?: string): void {
    for (const tracked of this.trackedJobs.values()) {
      if (tracked.abortController) {
        tracked.abortController.abort(reason);
      }
    }
  }

  /**
   * Gets a list of all tracked job IDs.
   * @returns Array of job IDs currently being tracked
   */
  getTrackedJobIds(): string[] {
    return Array.from(this.trackedJobs.keys());
  }
}
