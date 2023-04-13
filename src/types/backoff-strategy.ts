import { MinimalJob } from '../interfaces/minimal-job';

export type BackoffStrategy = (
  attemptsMade: number,
  type?: string,
  err?: Error,
  job?: MinimalJob,
) => Promise<number> | number;
