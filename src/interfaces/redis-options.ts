import IORedis from 'ioredis';

export type RedisOptions = IORedis.RedisOptions & {
  skipVersionCheck?: boolean;
};

export type ConnectionOptions = RedisOptions | IORedis.Redis;
