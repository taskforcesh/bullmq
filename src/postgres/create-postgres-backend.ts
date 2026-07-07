import { BackendFactory } from '../interfaces';
import {
  PostgresConnection,
  PostgresConnectionOptions,
} from './postgres-connection';
import { PostgresQueueBackend } from './postgres-queue-backend';

/**
 * {@link BackendFactory} that builds a {@link PostgresQueueBackend}.
 *
 * The returned backend owns its {@link PostgresConnection} (a `pg.Pool` plus a
 * dedicated `LISTEN` client); the high-level classes depend only on
 * `IQueueBackend` and never touch a `pg` client directly.
 *
 * The `opts.connection` value is forwarded to {@link PostgresConnection} and may
 * be a connection string, a node-postgres pool config (optionally carrying a
 * `schema`), or an already-built `pg.Pool` instance. `pg` is lazily required
 * only when a config/string is passed, so Redis-only users never need it
 * installed.
 *
 * Inject this into the queue classes (or set it as the process-wide default via
 * `setDefaultBackendFactory(createPostgresBackend)`) to back BullMQ with
 * PostgreSQL.
 */
export const createPostgresBackend: BackendFactory<PostgresQueueBackend> = (
  name,
  opts,
  factoryOpts = {},
) => {
  const connection = new PostgresConnection(
    opts.connection as unknown as PostgresConnectionOptions,
  );

  // Name a backend's dedicated, long-lived connection so it is discoverable via
  // getWorkers / getQueueEvents (pg_stat_activity) — the PostgreSQL analogue of
  // the Redis worker/queue-events named connection. Naming happens eagerly at
  // waitUntilReady (see PostgresQueueBackend) so the name is set as soon as the
  // backend is ready, exactly like Redis names its connection on creation.
  //   - Worker (withBlockingConnection): the bare queue name, or `:w:<name>`
  //     for a named worker — matching the getWorkers matcher.
  //   - QueueEvents (blocking): the queue name + `:qe` (QUEUE_EVENT_SUFFIX),
  //     matching the getQueueEvents matcher. (QueueEvents also re-applies this
  //     via setName when its consume loop starts.)
  // Producers/FlowProducer get no name (they must not be counted as workers).
  const workerName = (opts as { name?: string }).name;
  let listenClientName: string | undefined;
  if (factoryOpts.withBlockingConnection) {
    listenClientName = `${name}${workerName ? `:w:${workerName}` : ''}`;
  } else if (factoryOpts.blocking) {
    listenClientName = `${name}:qe`;
  }

  return new PostgresQueueBackend(
    connection,
    name,
    opts,
    true,
    listenClientName,
  );
};
