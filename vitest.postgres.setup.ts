/**
 * Vitest setup for running the **shared** BullMQ test suite against the
 * PostgreSQL backend.
 *
 * Two factories are wired:
 *  - The process-wide default *backend* factory → PostgreSQL, so every
 *    Queue/Worker/QueueEvents/FlowProducer the suite builds is backed by
 *    Postgres regardless of the `connection` option the test passes.
 *  - The test *connection* factory → ioredis, because the shared suite still
 *    creates raw connections for helpers (`createTestConnection`,
 *    `removeAllQueueData`). These are unused by the Postgres backend but the
 *    harness expects them to exist, so a Redis server is also required.
 *
 * Assumes both a PostgreSQL and a Redis server are already running.
 */
import { default as IORedis } from 'ioredis';
import { createIORedisClient } from './src/classes/ioredis-client';
import { setConnectionFactory } from './tests/utils/connection-factory';
import { setDefaultBackendFactory } from './src/utils/create-backend';
import { createPostgresBackend } from './src/postgres';
import { getPostgresUrl } from './tests/postgres/utils/postgres-url';

// Test connection factory (ioredis) — for the suite's raw-connection helpers.
setConnectionFactory(opts => {
  const client = new IORedis({
    host: opts?.host || process.env.REDIS_HOST || 'localhost',
    port: opts?.port || Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
  });
  return createIORedisClient(client);
});

// Default backend factory → PostgreSQL.
//
// The pool is pinned to `max: 1` so that concurrent producers (e.g. the
// `Promise.all(map(add))` patterns the shared suite uses) serialize their
// inserts on a single connection — reproducing the FIFO insertion order Redis
// gets for free from its single-connection command queue. The dedicated
// `LISTEN` client uses its own standalone connection, so `max: 1` does not
// starve workers/queue-events. Production code keeps the default pool size;
// concurrent multi-producer ordering is intentionally not guaranteed there.
const url = getPostgresUrl();
setDefaultBackendFactory((name, opts, options) =>
  createPostgresBackend(
    name,
    { ...opts, connection: { connectionString: url, max: 1 } },
    options,
  ),
);
