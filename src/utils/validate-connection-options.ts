import type { QueueBaseOptions } from '../interfaces/queue-options';
import { createRedisBackend, getDefaultBackendFactory } from './create-backend';

export function validateConnectionOptions(
  opts: QueueBaseOptions<unknown> | undefined,
  hasExplicitFactory: boolean,
): void {
  if (
    (!opts || opts.connection === undefined || opts.connection === null) &&
    (hasExplicitFactory || getDefaultBackendFactory() !== createRedisBackend)
  ) {
    throw new Error(
      'Connection options are required when using a backend factory',
    );
  }
}
