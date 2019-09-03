import { RateLimiterOpts } from './rate-limiter-opts';
import { Job } from '@src/classes';
import { QueueBaseOptions } from './queue-opts';
import { AdvancedOpts } from './advanced-opts';

export type Processor = (job: Job) => Promise<any>;

export interface WorkerOptions extends QueueBaseOptions {
  concurrency?: number;
  limiter?: RateLimiterOpts;
  skipDelayCheck?: boolean;
  drainDelay?: number;
  visibilityWindow?: number; // seconds,
  settings?: AdvancedOpts;
}
