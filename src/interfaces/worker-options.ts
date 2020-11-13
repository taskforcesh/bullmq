import { Job } from '../classes';
import { AdvancedOptions, QueueBaseOptions, RateLimiterOptions } from './';

export type Processor<T> = (job: Job<T>) => Promise<any>;

export interface WorkerOptions extends QueueBaseOptions {
  concurrency?: number;
  limiter?: RateLimiterOptions;
  skipDelayCheck?: boolean;
  drainDelay?: number;
  lockDuration?: number;
  lockRenewTime?: number;
  settings?: AdvancedOptions; // FIXME only backoffStrategies is used
}
