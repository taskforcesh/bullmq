//import { QueueBase } from "../classes/queue-base";

import { QueueBaseOptions } from '../interfaces/queue-options';
import { RedisClient } from '../interfaces/connection';
import { KeysMap } from '../classes/queue-keys';

/*export type MinimalQueue = Pick<
  QueueBase,
  | 'name'
  | 'client'
  | 'toKey'
  | 'keys'
  | 'opts'
  | 'closing'
  | 'waitUntilReady'
  | 'removeListener'
  | 'emit'
  | 'on'
  | 'redisVersion'
>;*/

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
