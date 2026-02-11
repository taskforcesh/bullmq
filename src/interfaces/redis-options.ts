import type * as IORedis from '@sinianluoye/ioredis';

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
  | IORedis.Cluster;
