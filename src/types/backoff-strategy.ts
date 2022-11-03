import { Job } from '../classes/job';

export type BackoffStrategy = (
  attemptsMade?: number,
  type?: string,
  err?: Error,
  job?: Job,
) => Promise<number> | number;
