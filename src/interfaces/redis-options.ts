import { Redis, RedisOptions as BaseRedisOptions, Cluster } from 'ioredis';

export type RedisOptions = BaseRedisOptions & {
  skipVersionCheck?: boolean;
};

export type ConnectionOptions = RedisOptions | Redis | Cluster;
