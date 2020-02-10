import * as Redis from 'ioredis';

export type RedisOptions = Redis.RedisOptions & {
  skipVersionCheck?: boolean;
};

export type ConnectionOptions = RedisOptions | Redis.Redis;
