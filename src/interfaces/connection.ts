import { EventEmitter } from 'events';
import { IRedisClient } from './redis-client';

export type RedisClient = IRedisClient;

export interface IConnection extends EventEmitter {
  waitUntilReady(): Promise<boolean>;
  client: Promise<RedisClient>;
}
