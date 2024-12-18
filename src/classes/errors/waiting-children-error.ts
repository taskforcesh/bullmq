export const WAITING_CHILDREN_ERROR = 'bullmq:movedToWaitingChildren';

/**
 * WaitingChildrenError
 *
 * Error to be thrown when job is moved to waiting-children state
 * from job in active state.
 *
 */
export class WaitingChildrenError extends Error {
  constructor(message: string = WAITING_CHILDREN_ERROR) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
