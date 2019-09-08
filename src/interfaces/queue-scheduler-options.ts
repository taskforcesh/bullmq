import { QueueBaseOptions } from '@src/interfaces';

export interface QueueSchedulerOptions extends QueueBaseOptions {
  maxStalledCount?: number;
  stalledInterval?: number;
}
