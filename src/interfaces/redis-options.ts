import type * as IORedis from 'ioredis';

interface BaseOptions {
  skipVersionCheck?: boolean;
}

export type RedisOptions = IORedis.RedisOptions & BaseOptions;

export type ClusterOptions = IORedis.ClusterOptions & BaseOptions;

export type ConnectionOptions =
  | RedisOptions
  | ClusterOptions
  | IORedis.Redis
  | IORedis.Cluster;
