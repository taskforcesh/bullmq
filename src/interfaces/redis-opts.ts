import IORedis from 'ioredis';

export interface RedisOpts {
  skipVersionCheck?: boolean;
  port: number;
  host: string;
}

export type ConnectionOptions = RedisOpts | IORedis.Redis;
