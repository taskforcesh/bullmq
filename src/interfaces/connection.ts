import { EventEmitter } from 'events';
import { Cluster, Redis } from 'ioredis';

export type RedisClient = Redis | Cluster;

export interface IConnection extends EventEmitter {
  waitUntilReady(): Promise<boolean>;
  client: Promise<RedisClient>;
}
