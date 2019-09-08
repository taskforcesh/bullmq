import { RateLimiterOptions } from './rate-limiter-options';
import { Job } from '@src/classes';
import { QueueBaseOptions } from './queue-options';
import { AdvancedOptions } from './advanced-options';

export type Processor = (job: Job) => Promise<any>;

export interface WorkerOptions extends QueueBaseOptions {
  concurrency?: number;
  limiter?: RateLimiterOptions;
  skipDelayCheck?: boolean;
  drainDelay?: number;
  visibilityWindow?: number; // seconds,
  settings?: AdvancedOptions;
}
