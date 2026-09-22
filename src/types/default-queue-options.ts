import type { ConnectionOptions } from '../interfaces/redis-options';
import type { QueueBaseOptions } from '../interfaces/queue-options';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/**
 * Only the default Redis specialization accepts optional options without a factory.
 */
export type DefaultQueueOptions<
  B,
  C,
  DefaultBackend,
  Options extends QueueBaseOptions = QueueBaseOptions,
  Extra extends unknown[] = [],
> =
  Equal<B, DefaultBackend> extends true
    ? Equal<C, ConnectionOptions> extends true
      ? [opts?: Options, backendFactory?: undefined, ...Extra]
      : [opts: never]
    : [opts: never];
