import { JobSchedulerRepeatOptions } from '../interfaces/repeat-options';

/**
 * Custom strategy used to compute the next execution time of a job scheduler.
 *
 * `opts.count` holds the number of iterations already produced by the scheduler.
 * It is managed internally and is only defined when the strategy is invoked
 * while the worker schedules the next iteration.
 */
export type RepeatStrategy = (
  millis: number,
  opts: JobSchedulerRepeatOptions,
  name?: string,
) => number | undefined | Promise<number | undefined>;
