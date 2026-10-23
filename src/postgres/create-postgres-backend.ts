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
 * Accepts a connection string, pool config (optionally carrying a `schema`),
 * or an existing `pg.Pool`. The `pg` driver is loaded lazily for config/string
 * connections; Redis-only users do not need it installed.
 *
 * Inject this into the queue classes (or set it as the process-wide default via
 * `setDefaultBackendFactory(createPostgresBackend)`) to back BullMQ with
 * PostgreSQL.
 */
export const createPostgresBackend: BackendFactory<
  PostgresQueueBackend,
  PostgresConnectionOptions
> = (name, opts) => {
  const connection = new PostgresConnection(opts.connection);
  return new PostgresQueueBackend(connection, name, opts, true);
};
