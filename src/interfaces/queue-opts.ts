import { JobsOpts } from '@src/interfaces';

import IORedis from 'ioredis';
import { ConnectionOptions } from './redis-opts';

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
  defaultJobOptions?: JobsOpts;
  createClient?: (type: ClientType) => IORedis.Redis;
}

export interface QueueEventsOptions extends QueueBaseOptions {
  lastEventId?: string;
  blockingTimeout?: number;
}
