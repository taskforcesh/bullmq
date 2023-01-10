import { JobImplementation } from '../interfaces/job-implementation';

export type BackoffStrategy = (
  attemptsMade?: number,
  type?: string,
  err?: Error,
  job?: JobImplementation,
) => Promise<number> | number;
