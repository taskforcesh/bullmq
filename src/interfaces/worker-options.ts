import { Job } from '../classes';
import { QueueBaseOptions, RateLimiterOptions } from './';

export type Processor = (job: Job) => Promise<any>;

export interface WorkerOptions extends QueueBaseOptions {
  concurrency?: number;
  limiter?: RateLimiterOptions;
  skipDelayCheck?: boolean;
  drainDelay?: number;
  lockDuration?: number;
  lockRenewTime?: number;
}
