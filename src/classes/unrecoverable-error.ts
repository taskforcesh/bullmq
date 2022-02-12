/**
 * UnrecoverableError
 *
 * Error to pass a job to failed even if the attemptsMade
 * are lower than the expected limit.
 *
 */
export class UnrecoverableError extends Error {
  constructor(message: string) {
    super(message);
  }

  get name(): string {
    return this.constructor.name;
  }
}
