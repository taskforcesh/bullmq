import { Span } from './telemetry';

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
