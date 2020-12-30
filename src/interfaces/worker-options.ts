import { Job } from '../classes';
import { AdvancedOptions, QueueBaseOptions, RateLimiterOptions } from './';

export type Processor<T = any, R = any, N extends string = string> = (
  job: Job<T, R, N>,
) => Promise<R>;

export interface WorkerOptions extends QueueBaseOptions {
  concurrency?: number;
  limiter?: RateLimiterOptions;
  skipDelayCheck?: boolean;
  drainDelay?: number;
  lockDuration?: number;
  lockRenewTime?: number;
  settings?: AdvancedOptions; // FIXME only backoffStrategies is used
}
