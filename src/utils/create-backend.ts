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
 * {@link BackendFactory}. The returned backend owns its connection(s); the
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
  // QueueEvents' main connection (`blocking: true`) must be dedicated: if the
  // caller passed a raw client instance (rather than options), duplicate it
  // so this instance never shares its consumption of the connection with
  // whatever else the caller is doing with the original client.
  const mainConnectionOpts =
    blocking && isRedisInstance(opts.connection)
      ? (isIRedisClient(opts.connection)
          ? opts.connection
          : createIORedisClient(opts.connection as any)
        ).duplicate()
      : opts.connection;

  const connection = new RedisConnection(mainConnectionOpts, {
    shared: isRedisInstance(mainConnectionOpts),
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
let defaultBackendFactory: BackendFactory =
  createRedisBackend as unknown as BackendFactory;

/**
 * Overrides the process-wide default {@link BackendFactory}. Useful to point
 * every Queue/Worker/FlowProducer at a different datastore (e.g. the PostgreSQL
 * backend) without threading a factory through every constructor — notably so
 * the existing test suite can run unchanged against another backend.
 *
 * Pass no argument (or `undefined`) to reset back to the Redis backend.
 *
 * Generic over `B`/`C` so a backend-specific factory (e.g.
 * `createPostgresBackend`, whose `C` is its own connection-options type) can be
 * passed in without a cast at the call site. The process-wide default is
 * necessarily type-erased internally (it must be able to hold *any* backend's
 * factory), which is what the single, well-contained cast below accounts for.
 */
export function setDefaultBackendFactory<
  B extends IQueueBackend = IQueueBackend,
  C = ConnectionOptions,
>(factory?: BackendFactory<B, C>): void {
  defaultBackendFactory =
    (factory as unknown as BackendFactory) ??
    (createRedisBackend as unknown as BackendFactory);
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
