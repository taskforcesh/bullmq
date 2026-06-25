import { RedisQueueBackend } from '../../src/classes/redis-queue-backend';
import { RedisConnection } from '../../src/classes/redis-connection';
import { IQueueBackend, RedisClient } from '../../src/interfaces';

/**
 * Test-only helper to reach the raw Redis client behind a queue-like object.
 *
 * The high-level classes (`Queue`, `Worker`, `FlowProducer`, …) no longer
 * expose a `client` getter: they are datastore-agnostic and only know about
 * {@link IQueueBackend}. The raw Redis client is a Redis-specific escape hatch
 * that lives on the concrete {@link RedisQueueBackend} implementation.
 *
 * This helper is a drop-in replacement for the old `await queue.client`: the
 * backend's `client` getter resolves once the underlying connection is ready.
 */
export function getRedisClient(target: {
  getBackend(): IQueueBackend;
}): Promise<RedisClient> {
  return (target.getBackend() as RedisQueueBackend).client;
}

/**
 * Test-only helper to reach the raw blocking Redis client behind a worker-like
 * object (Redis-specific escape hatch on {@link RedisQueueBackend}). This is
 * the connection that registers as a worker (`:w:` suffix).
 */
export function getBlockingRedisClient(target: {
  getBackend(): IQueueBackend;
}): Promise<RedisClient> | undefined {
  return (target.getBackend() as RedisQueueBackend).blockingClient;
}

/**
 * Test-only helper to reach the underlying {@link RedisConnection} of a
 * queue-like object (Redis-specific escape hatch on {@link RedisQueueBackend}).
 */
export function getRedisConnection(target: {
  getBackend(): IQueueBackend;
}): RedisConnection {
  return (target.getBackend() as RedisQueueBackend).connection;
}

/**
 * Test-only helper to reach the dedicated blocking {@link RedisConnection} of a
 * worker-like object (Redis-specific escape hatch on {@link RedisQueueBackend}).
 */
export function getBlockingRedisConnection(target: {
  getBackend(): IQueueBackend;
}): RedisConnection | undefined {
  return (target.getBackend() as RedisQueueBackend).blockingConnection;
}

/**
 * Test-only helper to read the detected Redis server version behind a
 * queue-like object (Redis-specific escape hatch on {@link RedisQueueBackend}).
 */
export function getRedisVersion(target: {
  getBackend(): IQueueBackend;
}): string {
  return (target.getBackend() as RedisQueueBackend).redisVersion;
}

/**
 * Test-only helper to read the detected datastore flavour behind a queue-like
 * object (Redis-specific escape hatch on {@link RedisQueueBackend}).
 */
export function getDatabaseType(target: {
  getBackend(): IQueueBackend;
}): string {
  return (target.getBackend() as RedisQueueBackend).databaseType;
}
