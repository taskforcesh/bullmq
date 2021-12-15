import { Redis, RedisOptions as BaseRedisOptions, ClusterOptions, Cluster } from 'ioredis';

export type RedisOptions = (BaseRedisOptions | ClusterOptions) & {
  skipVersionCheck?: boolean;
};

export type ConnectionOptions = RedisOptions | Redis | Cluster;
