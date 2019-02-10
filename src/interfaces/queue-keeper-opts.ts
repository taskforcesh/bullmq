import { QueueBaseOptions } from '@src/interfaces';

export interface QueueKeeperOptions extends QueueBaseOptions {
  maxStalledCount?: number;
  stalledInterval?: number;
}
