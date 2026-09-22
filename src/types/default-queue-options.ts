import type { ConnectionOptions } from '../interfaces/redis-options';
import type { QueueBaseOptions } from '../interfaces/queue-options';
import type { RedisQueueBackend } from '../classes/redis-queue-backend';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/**
 * Only the class default or concrete Redis backend with default Redis connection
 * options accepts optional options without a factory.
 */
export type DefaultQueueOptions<
  B,
  C,
  DefaultBackend,
  Options extends QueueBaseOptions = QueueBaseOptions,
  Extra extends unknown[] = [],
> = true extends Equal<B, DefaultBackend> | Equal<B, RedisQueueBackend>
  ? Equal<C, ConnectionOptions> extends true
    ? [opts?: Options, backendFactory?: undefined, ...Extra]
    : [opts: never]
  : [opts: never];
