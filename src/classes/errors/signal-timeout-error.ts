export const SIGNAL_TIMEOUT_ERROR = 'bullmq:signalTimeout';

/**
 * SignalTimeoutError
 *
 * Thrown by {@link Job.waitForSignal} when the wait for a signal times out.
 * Catch it in the processor to decide what to do; if it is not caught, the
 * job fails like with any other error.
 */
export class SignalTimeoutError extends Error {
  /**
   * @param signalName - The name of the signal the job was waiting for.
   */
  constructor(
    public readonly signalName: string,
    message = `${SIGNAL_TIMEOUT_ERROR}: timed out waiting for signal "${signalName}"`,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
