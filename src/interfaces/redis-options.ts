import IORedis from 'ioredis';

export interface RedisOptions {
  skipVersionCheck?: boolean;
  port: number;
  host: string;
}

export type ConnectionOptions = RedisOptions | IORedis.Redis;
