import type * as IORedis from 'ioredis';
import { IRedisClient } from './redis-client';

export interface BaseOptions {
  skipVersionCheck?: boolean;
  url?: string;
}

export type RedisOptions = IORedis.RedisOptions & BaseOptions;

export type ClusterOptions = IORedis.ClusterOptions & BaseOptions;

export type ConnectionOptions =
  | RedisOptions
  | ClusterOptions
  | IORedis.Redis
  | IORedis.Cluster
  | IRedisClient
  | IORedis.Cluster;
