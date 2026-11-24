/**
 * Options for {@link Job.waitForSignal}.
 */
export interface WaitForSignalOpts {
  /**
   * How long to wait for the signal, in milliseconds. The deadline is set by
   * the first wait for a signal name and kept when the job runs again while
   * waiting for it.
   */
  timeout: number;
}

/**
 * Result of the backend operation behind {@link Job.waitForSignal}.
 *
 * - `signal`: the signal is stored, `data` is its JSON payload.
 * - `delayed`: the job was moved to delayed to wait for the signal.
 * - `timeout`: the deadline passed without the signal.
 */
export type WaitForSignalResult =
  | { status: 'signal'; data: string }
  | { status: 'delayed' }
  | { status: 'timeout' };

/**
 * Result of {@link Queue.signal}.
 *
 * - `woken`: the job was waiting for this signal and was moved back to wait.
 * - `stored`: the signal was stored; the job reads it when it waits for it.
 */
export type SignalResult = 'woken' | 'stored';
