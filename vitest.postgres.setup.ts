/**
 * Vitest setup for running the **shared** BullMQ test suite against the
 * PostgreSQL backend.
 *
 * Two factories are wired:
 *  - The process-wide default *backend* factory → PostgreSQL, so every
 *    Queue/Worker/QueueEvents/FlowProducer the suite builds is backed by
 *    Postgres regardless of the `connection` option the test passes.
 *  - The test *connection* factory → a no-op client. The Postgres backend
 *    factory below ignores whatever `connection` a test passes (it talks to
 *    Postgres), so the shared suite never issues a Redis command through this
 *    object. It exists only because the shared (Redis-oriented) suite still
 *    constructs a `connection` and hands it to every Queue/Worker/QueueEvents,
 *    and calls `connection.quit()` in teardown. Per-test data cleanup goes
 *    through the backend (`cleanupQueue` → `obliterate`), not this client, and
 *    test isolation comes from the per-run schema drop (globalSetup) plus
 *    unique random queue names — so the Postgres run needs **no Redis server**.
 *
 * Assumes a PostgreSQL server is already running.
 */
import { setConnectionFactory } from './tests/utils/connection-factory';
import { setDefaultBackendFactory } from './src/utils/create-backend';
import { createPostgresBackend } from './src/postgres';
import { getPostgresUrl } from './tests/postgres/utils/postgres-url';
import type { IRedisClient } from './src/interfaces';

// Test connection factory → a no-op client. It implements just enough of the
// client surface for `isRedisInstance` (connect/disconnect/duplicate) and the
// `connection.quit()` teardown calls the shared suite makes; every method is
// inert (the Postgres backend never talks through it).
setConnectionFactory(() => {
  const client: Record<string, unknown> = {
    isCluster: false,
    status: 'ready',
    options: {},
    connect: async () => undefined,
    disconnect: () => undefined,
    quit: async () => 'OK',
    duplicate: () => client,
    on: () => client,
    once: () => client,
    off: () => client,
    removeListener: () => client,
    emit: () => false,
  };
  return client as unknown as IRedisClient;
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
// Marker so the (very few) shared tests whose *child-process fixtures* spawn a
// raw Redis connection can skip themselves under the Postgres backend. Regular
// tests never need this — the backend is chosen by the factory above.
process.env.BULLMQ_TEST_BACKEND = 'postgres';
setDefaultBackendFactory((name, opts, options) =>
  createPostgresBackend(
    name,
    { ...opts, connection: { connectionString: url, max: 1 } },
    options,
  ),
);
