import { AbortController } from './abort-controller';
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
   *
   * If the manager has already been closed, or the configured
   * `lockRenewTime` is not greater than zero, this is a no-op.
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
   * Stops the lock manager, clears the renewal timer and releases
   * all tracked jobs.
   *
   * Once closed the instance cannot be restarted; subsequent calls
   * to {@link start} or {@link trackJob} will have no effect.
   *
   * @returns A promise that resolves once the manager has been closed.
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
   *
   * The manager will periodically extend the lock on the job using the
   * provided token until {@link untrackJob} is called or the manager
   * is closed.
   *
   * @param jobId - The ID of the job to track.
   * @param token - The lock token associated with the job.
   * @param ts - The timestamp (ms) when the lock was last acquired or renewed.
   * @param shouldCreateController - When `true`, a new
   *   {@link AbortController} is created and associated with the job so that
   *   it can later be cancelled via {@link cancelJob} or
   *   {@link cancelAllJobs}. Defaults to `false`.
   * @returns The created {@link AbortController} when
   *   `shouldCreateController` is `true`, otherwise `undefined`.
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
   *
   * After this call the job's lock will no longer be extended by the
   * manager. Calling it with an unknown job ID is a no-op.
   *
   * @param jobId - The ID of the job to stop tracking.
   */
  untrackJob(jobId: string): void {
    this.trackedJobs.delete(jobId);
  }

  /**
   * Gets the number of jobs currently being tracked.
   *
   * @returns The number of jobs whose locks are being renewed by this
   *   manager.
   */
  getActiveJobCount(): number {
    return this.trackedJobs.size;
  }

  /**
   * Checks if the lock manager is running.
   *
   * The manager is considered running when it has not been closed and
   * its renewal timer is active.
   *
   * @returns `true` when the manager is active and renewing locks,
   *   `false` otherwise.
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
