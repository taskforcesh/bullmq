import { JobsOptions } from '@src/interfaces';

import IORedis from 'ioredis';
import { ConnectionOptions } from './redis-options';

export enum ClientType {
  blocking = 'blocking',
  normal = 'normal',
}

export interface QueueBaseOptions {
  connection?: ConnectionOptions;
  client?: IORedis.Redis;
  prefix?: string; // prefix for all queue keys.
}

export interface QueueOptions extends QueueBaseOptions {
  defaultJobOptions?: JobsOptions;

  streams?: {
    events: {
      maxLen: number; // Max aproximated length for streams
    };
  };
}

export interface QueueEventsOptions extends QueueBaseOptions {
  lastEventId?: string;
  blockingTimeout?: number;
}
