import { KeysMap } from '../classes/queue-keys';
import { RedisClient } from './connection';
import { QueueBaseOptions } from './queue-options';

export interface MinimalQueue {
  name: string;
  opts: QueueBaseOptions;
  toKey: (type: string) => string;
  keys: KeysMap;
  closing: Promise<void>;
  client: Promise<RedisClient>;
  redisVersion: string;
  emit: (event: string, ...args: any[]) => boolean;
  waitUntilReady: () => Promise<RedisClient>;
  on: (event: string | symbol, listener: (...args: any[]) => void) => this;
  removeListener: (
    event: string | symbol,
    listener: (...args: any[]) => void,
  ) => this;
}
