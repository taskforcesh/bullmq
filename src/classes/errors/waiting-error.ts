export const WAITING_ERROR = 'bullmq:movedToWait';

/**
 * WaitingError
 *
 * Error to be thrown when job is moved to wait or prioritized state
 * from job in active state.
 */
export class WaitingError extends Error {
  constructor(message: string = WAITING_ERROR) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
