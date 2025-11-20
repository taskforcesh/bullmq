import { Job } from '../classes/job';

/**
 * An async function that receives `Job`s and handles them.
 */
export type Processor<T = any, R = any, N extends string = string> = (
  job: Job<T, R, N>,
  token?: string,
  signal?: AbortSignal,
) => Promise<R>;
