import type { ConnectionOptions } from '../interfaces/redis-options';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/**
 * Only the default Redis specialization can omit connection options.
 */
export type DefaultQueueOptions<
  B,
  C,
  DefaultBackend,
  Extra extends unknown[] = [],
> =
  Equal<B, DefaultBackend> extends true
    ? Equal<C, ConnectionOptions> extends true
      ? [opts?: undefined, backendFactory?: undefined, ...Extra]
      : [opts: never]
    : [opts: never];
