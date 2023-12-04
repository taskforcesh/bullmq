/**
 * DelayedError
 *
 * Error to be thrown when job is moved to delayed state
 * from job in active state.
 *
 */
export class DelayedError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
