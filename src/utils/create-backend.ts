import {
  BackendFactory,
  ConnectionOptions,
  IQueueBackend,
  KeyPrefixOptions,
  QueueBaseOptions,
} from '../interfaces';
import { RedisQueueBackend } from '../classes/redis-queue-backend';
import { RedisConnection } from '../classes/redis-connection';
import { QueueKeys } from '../classes/queue-keys';
import { createIORedisClient, isIRedisClient } from '../classes/ioredis-client';
import { isRedisInstance } from './index';

/**
 * Builds the dedicated, blocking connection that a worker needs so its blocking
 * fetch (`BZPOPMIN`) does not stall regular operations. Reuses / duplicates the
 * provided connection options with its own name.
 */
const createBlockingConnection = (
  name: string,
  opts: QueueBaseOptions,
): RedisConnection => {
  const base64Name = Buffer.from(name).toString('base64');
  const workerName = (opts as { name?: string }).name;
  const connectionName = `${(opts as KeyPrefixOptions).prefix ?? 'bull'}:${base64Name}${
    workerName ? `:w:${workerName}` : ''
  }`;

  return new RedisConnection(
    isRedisInstance(opts.connection)
      ? (isIRedisClient(opts.connection)
          ? opts.connection
          : createIORedisClient(opts.connection as any)
        ).duplicate({ connectionName })
      : { ...opts.connection, connectionName },
    {
      shared: false,
      blocking: true,
      skipVersionCheck: opts.skipVersionCheck,
    },
  );
};

/**
 * The default ({@link RedisConnection}-based) implementation of
 * {@link BackendFactory}. The backend owns connections it creates, including
 * duplicates, but leaves caller-owned clients open. The
 * high-level classes (Queue, Worker, FlowProducer, …) depend only on
 * {@link IQueueBackend} and never touch a Redis client directly.
 *
 * Other datastores can provide their own {@link BackendFactory} and inject it
 * into the queue classes.
 */
export const createRedisBackend: BackendFactory<RedisQueueBackend> = (
  name,
  opts,
  { blocking = false, withBlockingConnection = false } = {},
) => {
  // A blocking consumer must not block the caller's shared Redis client.
  const mainConnectionOpts =
    blocking && isRedisInstance(opts.connection)
      ? (isIRedisClient(opts.connection)
          ? opts.connection
          : createIORedisClient(opts.connection as any)
        ).duplicate()
      : opts.connection;

  const connection = new RedisConnection(mainConnectionOpts, {
    shared: !blocking && isRedisInstance(opts.connection),
    blocking,
    skipVersionCheck: opts.skipVersionCheck,
    skipWaitingForReady: opts.skipWaitingForReady,
  });

  const blockingConnection = withBlockingConnection
    ? createBlockingConnection(name, opts)
    : undefined;

  const queueKeys = new QueueKeys((opts as KeyPrefixOptions).prefix);
  const keys = queueKeys.getKeys(name);
  const toKey = (type: string) => queueKeys.toKey(name, type);

  return new RedisQueueBackend(
    connection,
    name,
    keys,
    toKey,
    opts,
    blockingConnection,
  );
};

/**
 * The process-wide default {@link BackendFactory} used by the high-level
 * classes ({@link QueueBase}, {@link FlowProducer}) when the caller does not
 * pass an explicit `backendFactory`. Initialised to the Redis backend so the
 * default behaviour is unchanged.
 */
let defaultBackendFactory: BackendFactory = createRedisBackend;

/**
 * Overrides the process-wide default {@link BackendFactory}. Useful to point
 * every Queue/Worker/FlowProducer at a different datastore (e.g. the PostgreSQL
 * backend) without threading a factory through every constructor — notably so
 * the existing test suite can run unchanged against another backend.
 *
 * Pass no argument (or `undefined`) to reset back to the Redis backend.
 *
 * Registration changes runtime behavior, not constructor type defaults.
 * Use {@link withBackend} to retain the factory's types.
 */
export function setDefaultBackendFactory<
  B extends IQueueBackend = IQueueBackend,
  C = ConnectionOptions,
>(factory?: BackendFactory<B, C>): void {
  defaultBackendFactory =
    (factory as unknown as BackendFactory) ?? createRedisBackend;
}

/**
 * Returns the current process-wide default {@link BackendFactory}, typed as the
 * caller's concrete backend `B` and connection-options type `C`.
 */
export function getDefaultBackendFactory<
  B extends IQueueBackend = IQueueBackend,
  C = ConnectionOptions,
>(): BackendFactory<B, C> {
  return defaultBackendFactory as unknown as BackendFactory<B, C>;
}
