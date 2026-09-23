import { IRedisClient } from './redis-client';

export interface BaseOptions {
  skipVersionCheck?: boolean;
  url?: string;
}

export interface RedisOptions extends BaseOptions {
  host?: string;
  port?: number;
  family?: number;
  db?: number;
  username?: string;
  password?: string;
  connectionName?: string;
  keyPrefix?: string;
  enableOfflineQueue?: boolean;
  maxRetriesPerRequest?: number | null;
  retryStrategy?: (times: number) => number | void | null;
  lazyConnect?: boolean;
  tls?: any;
  [key: string]: any;
}

export interface ClusterOptions extends BaseOptions {
  maxRetriesPerRequest?: number | null;
  enableOfflineQueue?: boolean;
  retryStrategy?: (times: number) => number | void | null;
  lazyConnect?: boolean;
  redisOptions?: RedisOptions;
  scaleReads?: string;
  [key: string]: any;
}

export interface RedisConnectionClient {
  connect(...args: any[]): any;
  duplicate(...args: any[]): any;
  disconnect?(...args: any[]): any;
  close?(...args: any[]): any;
  on?(...args: any[]): any;
  defineCommand?(...args: any[]): any;
  sendCommand?(...args: any[]): any;
  send?(...args: any[]): any;
  isCluster?: boolean;
  [key: string]: any;
}

export type ConnectionOptions =
  RedisOptions | ClusterOptions | IRedisClient | RedisConnectionClient;
