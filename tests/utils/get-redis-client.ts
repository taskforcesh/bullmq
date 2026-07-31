import { RedisQueueBackend } from '../../src/classes/redis-queue-backend';
import { RedisConnection } from '../../src/classes/redis-connection';
import { RedisClient } from '../../src/interfaces';

/**
 * A queue-like object backed by the Redis adapter. The built-in classes
 * (`Queue`, `Worker`, `FlowProducer`) are parameterized on
 * {@link RedisQueueBackend} by default, so `getBackend()` returns the concrete
 * adapter and these helpers need no casting.
 */
interface RedisBackedTarget {
  getBackend(): RedisQueueBackend;
}

/**
 * Test-only helper to reach the raw Redis client behind a queue-like object.
 *
 * The high-level classes (`Queue`, `Worker`, `FlowProducer`, …) no longer
 * expose a `client` getter: they are datastore-agnostic and only know about
 * their backend. The raw Redis client is a Redis-specific escape hatch that
 * lives on the concrete {@link RedisQueueBackend} implementation.
 *
 * This helper is a drop-in replacement for the old `await queue.client`: the
 * backend's `client` getter resolves once the underlying connection is ready.
 */
export function getRedisClient(
  target: RedisBackedTarget,
): Promise<RedisClient> {
  return target.getBackend().client;
}

/**
 * Test-only helper to reach the raw blocking Redis client behind a worker-like
 * object (Redis-specific escape hatch on {@link RedisQueueBackend}). This is
 * the connection that registers as a worker (`:w:` suffix).
 *
 * Throws if the target's backend has no blocking client so call sites can
 * safely treat the result as a non-optional `Promise<RedisClient>`.
 */
export function getBlockingRedisClient(
  target: RedisBackedTarget,
): Promise<RedisClient> {
  const blockingClient = target.getBackend().blockingClient;
  if (!blockingClient) {
    throw new Error(
      'Target backend has no blocking Redis client (it was not created with a blocking connection)',
    );
  }
  return blockingClient;
}

/**
 * Test-only helper to reach the underlying {@link RedisConnection} of a
 * queue-like object (Redis-specific escape hatch on {@link RedisQueueBackend}).
 */
export function getRedisConnection(target: RedisBackedTarget): RedisConnection {
  return target.getBackend().connection;
}

/**
 * Test-only helper to reach the dedicated blocking {@link RedisConnection} of a
 * worker-like object (Redis-specific escape hatch on {@link RedisQueueBackend}).
 *
 * Throws if the target's backend has no blocking connection so call sites can
 * safely treat the result as a non-optional `RedisConnection`.
 */
export function getBlockingRedisConnection(
  target: RedisBackedTarget,
): RedisConnection {
  const blockingConnection = target.getBackend().blockingConnection;
  if (!blockingConnection) {
    throw new Error(
      'Target backend has no blocking connection (it was not created with a blocking connection)',
    );
  }
  return blockingConnection;
}

/**
 * Test-only helper to read the detected Redis server version behind a
 * queue-like object (Redis-specific escape hatch on {@link RedisQueueBackend}).
 */
export function getRedisVersion(target: RedisBackedTarget): string {
  return target.getBackend().redisVersion;
}

/**
 * Test-only helper to read the detected datastore flavour behind a queue-like
 * object (Redis-specific escape hatch on {@link RedisQueueBackend}).
 */
export function getDatabaseType(target: RedisBackedTarget): string {
  return target.getBackend().databaseType;
}
