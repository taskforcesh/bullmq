import { RedisClient } from './connection';
import { QueueBaseOptions } from './queue-options';
import { KeysMap } from '../classes/queue-keys';

export interface ScriptQueueContext {
  opts: QueueBaseOptions;
  toKey: (type: string) => string;
  keys: KeysMap;
  closing: Promise<void> | undefined;
  /**
   * Returns a promise that resolves to a redis client. Normally used only by subclasses.
   */
  get client(): Promise<RedisClient>;
  /**
   * Returns the version of the Redis instance the client is connected to,
   */
  get redisVersion(): string;
}
