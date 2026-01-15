import type * as IORedis from 'ioredis';

export interface BaseOptions {
  skipVersionCheck?: boolean | undefined;
  url?: string | undefined;
}

export type RedisOptions = IORedis.RedisOptions & BaseOptions;

export type ClusterOptions = IORedis.ClusterOptions & BaseOptions;

export type ConnectionOptions =
  | RedisOptions
  | ClusterOptions
  | IORedis.Redis
  | IORedis.Cluster;
