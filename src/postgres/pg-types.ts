/**
 * Minimal structural subset of the `pg` (node-postgres) client surface that the
 * PostgreSQL backend relies on.
 *
 * We deliberately depend on this tiny local interface instead of `@types/pg` so
 * that:
 *
 * - Redis-only users never need `pg` (or its types) installed — the driver is an
 *   optional dependency that is lazy-required by the factory.
 * - The migrator and SQL helpers stay trivially unit-testable with a fake
 *   queryable, and remain easy to port conceptually to other runtimes.
 *
 * Any real `pg.Client` / `pg.Pool` / `pg.PoolClient` is structurally assignable
 * to {@link PgQueryable}.
 */
export interface PgQueryResult<R = any> {
  rows: R[];
  rowCount?: number | null;
}

export interface PgQueryable {
  query<R = any>(
    text: string,
    params?: readonly unknown[],
  ): Promise<PgQueryResult<R>>;
}

/**
 * A `LISTEN`/`NOTIFY` payload as delivered by node-postgres on a connection's
 * `'notification'` event.
 */
export interface PgNotification {
  channel: string;
  payload?: string;
  processId?: number;
}

/**
 * The common surface of a long-lived `LISTEN`/`NOTIFY` connection, satisfied by
 * both a pooled client ({@link PgPoolClient}) and a standalone client
 * ({@link PgClient}). The backend only needs to run queries and (un)subscribe to
 * notifications on it — never to release/end it (the {@link PgPool} owner does).
 */
export interface PgListenClient extends PgQueryable {
  on(event: 'notification', listener: (msg: PgNotification) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'end', listener: () => void): this;
  removeListener(
    event: 'notification',
    listener: (msg: PgNotification) => void,
  ): this;
  removeAllListeners(event?: string): this;
}

/**
 * Structural subset of a `pg.PoolClient` (a single checked-out connection). Used
 * for the dedicated migration session.
 */
export interface PgPoolClient extends PgListenClient {
  release(destroy?: boolean): void;
}

/**
 * Structural subset of a standalone `pg.Client` (its own dedicated connection,
 * not a pool slot). Used for the long-lived `LISTEN` client so it never starves
 * the query pool.
 */
export interface PgClient extends PgListenClient {
  connect(): Promise<void>;
  end(): Promise<void>;
}

/**
 * Structural subset of a `pg.Pool`. A real `pg.Pool` is assignable to this.
 */
export interface PgPool extends PgQueryable {
  connect(): Promise<PgPoolClient>;
  end(): Promise<void>;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'connect', listener: (client: PgPoolClient) => void): this;
  removeAllListeners(event?: string): this;
}

/**
 * Connection configuration accepted by `new pg.Pool(config)`. Kept loose (a
 * superset via the index signature) so callers can pass any node-postgres pool
 * option without us re-declaring the full `pg.PoolConfig`.
 */
export interface PgPoolConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  max?: number;
  [key: string]: unknown;
}

/**
 * The lazily-required `pg` module surface the backend needs.
 */
export interface PgModule {
  Pool: new (config?: PgPoolConfig | string) => PgPool;
  Client: new (config?: PgPoolConfig | string) => PgClient;
}

/**
 * Narrows whether a user-provided connection value is already an instantiated
 * `pg.Pool` (as opposed to a config object / connection string that we must use
 * to construct one).
 */
export function isPgPool(value: unknown): value is PgPool {
  return (
    !!value &&
    typeof (value as PgPool).connect === 'function' &&
    typeof (value as PgPool).query === 'function' &&
    typeof (value as PgPool).end === 'function'
  );
}
