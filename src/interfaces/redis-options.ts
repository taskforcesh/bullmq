import { Redis, RedisOptions as BaseRedisOptions } from 'ioredis';

export type RedisOptions = BaseRedisOptions & {
  skipVersionCheck?: boolean;
};

export type ConnectionOptions = RedisOptions | Redis;
