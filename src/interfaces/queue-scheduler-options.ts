import { QueueBaseOptions } from '../interfaces';

export interface QueueSchedulerOptions extends QueueBaseOptions {
  maxStalledCount?: number;
  stalledInterval?: number;
}
