import { Job } from '../classes/job';
import { JobProgress } from './job-progress';

/**
 * An async function that receives `Job`s and handles them.
 */
export type Processor<
  T = any,
  R = any,
  N extends string = string,
  P extends JobProgress = JobProgress,
> = (job: Job<T, R, N, P>, token?: string, signal?: AbortSignal) => Promise<R>;
