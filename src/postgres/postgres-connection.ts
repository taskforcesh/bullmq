import { EventEmitter } from 'events';
import {
  isPgPool,
  PgClient,
  PgListenClient,
  PgModule,
  PgPool,
  PgPoolClient,
  PgPoolConfig,
} from './pg-types';
import { DEFAULT_SCHEMA, quoteSchemaName, runMigrations } from './migrator';

/**
 * A node-postgres pool config / connection string, optionally carrying the
 * BullMQ-specific `schema` (the connection-level namespace for all queues) and
 * `skipVersionCheck` (bypass the minimum-server-version assertion).
 */
export type PostgresPoolConfig = PgPoolConfig & {
  schema?: string;
  skipVersionCheck?: boolean;
};

/**
 * What the user may pass as the PostgreSQL `connection` option:
 *
 * - an already-constructed `pg.Pool` instance (we use it as-is and do NOT close
 *   it on `close()` — the caller owns its lifecycle), or
 * - a node-postgres pool config / connection string (we lazily `require('pg')`
 *   and construct the pool ourselves, owning its lifecycle).
 *
 * The optional `schema` (the namespace for all queues) is only read from the
 * **config-object** form, because that is the only case where we build the pool
 * ourselves and can pin each connection's `search_path` to it. A bare
 * connection string or an already-constructed `pg.Pool` always uses
 * {@link DEFAULT_SCHEMA} — a raw pool cannot carry a `schema`, and we cannot set
 * the `search_path` on a pool we did not create. To select a different schema,
 * pass a config object (a connection string can be wrapped as
 * `{ connectionString, schema }`; a pre-built pool must be configured with the
 * desired `search_path` by the caller).
 */
export type PostgresConnectionOptions = PgPool | PostgresPoolConfig | string;

/**
 * Lazily loads the optional `pg` (node-postgres) driver. Redis-only users never
 * hit this path, so they never need `pg` installed.
 *
 * Only reached when the caller passes a config/connection string (not an
 * already-constructed `pg.Pool`). In native ESM environments where `require` is
 * unavailable, callers should pass a `pg.Pool` instance instead.
 */
function loadPgModule(): PgModule {
  try {
    if (typeof require === 'function') {
      return require('pg') as PgModule;
    }
  } catch {
    // Fall through to the friendly error below.
  }
  throw new Error(
    "The PostgreSQL backend could not load the optional 'pg' package. " +
      'Install it with `npm install pg`. In a native ESM environment, pass an ' +
      'already-constructed `pg.Pool` instance as the connection instead of a ' +
      'config object or connection string.',
  );
}

/**
 * Owns the PostgreSQL connection resources for a single backend:
 *
 * - a `pg.Pool` for regular, short-lived queries, and
 * - a dedicated, long-lived `LISTEN` client used by the blocking
 *   "wait for job" primitive (lazily established).
 *
 * Lifecycle mirrors {@link RedisConnection}: it is an {@link EventEmitter} that
 * surfaces normalized `'ready' | 'error' | 'close'` events, exposes
 * {@link PostgresConnection.waitUntilReady} (which also runs the schema
 * migrations exactly once, on a dedicated checked-out client) and
 * {@link PostgresConnection.close}.
 */
export class PostgresConnection extends EventEmitter {
  readonly pool: PgPool;

  /**
   * The PostgreSQL schema (namespace) this connection's queues live in. It is
   * applied to every pooled connection's `search_path`, so the `.sql` command
   * files (and the operation functions) reference unqualified names and stay
   * portable — the schema selects the namespace, never the SQL itself.
   */
  readonly schema: string;

  /**
   * `true` when this instance constructed the pool (and must therefore close
   * it). `false` when the user passed in their own `pg.Pool`.
   */
  private readonly ownsPool: boolean;

  /**
   * When `true`, the minimum-server-version assertion in {@link runMigrations}
   * is skipped. Only settable via a config object (a raw `pg.Pool` or a bare
   * connection string always run the check).
   */
  private readonly skipVersionCheck: boolean;

  private readyPromise: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private listenClient: PgListenClient | undefined;

  /**
   * Memoizes the in-flight {@link PostgresConnection.getListenClient}
   * establishment so concurrent first-callers (e.g. a backend naming its
   * connection in `waitUntilReady` while its consume loop also asks for the
   * LISTEN client) all share one connection instead of each opening a
   * duplicate.
   */
  private listenClientPromise: Promise<PgListenClient> | undefined;

  /**
   * When this instance owns the pool, the lazily-required `pg` module and the
   * resolved client config (with the pinned `search_path`) used to build a
   * *dedicated standalone* `LISTEN` connection — so a long-lived `LISTEN` never
   * consumes a pool slot. Undefined when the user passed their own `pg.Pool`
   * (then the `LISTEN` client is checked out of that pool instead).
   */
  private readonly pgModule: PgModule | undefined;
  private readonly listenClientConfig: PgPoolConfig | undefined;

  /**
   * `true` when {@link listenClient} is a standalone `pg.Client` we must `end()`
   * (owned pool); `false` when it is a pooled client we must `release()`.
   */
  private listenClientIsStandalone = false;

  constructor(connection: PostgresConnectionOptions) {
    super();

    if (isPgPool(connection)) {
      this.pool = connection;
      this.ownsPool = false;
      this.schema = DEFAULT_SCHEMA;
      this.skipVersionCheck = false;
      this.pgModule = undefined;
      this.listenClientConfig = undefined;
    } else {
      const pg = loadPgModule();
      const { schema, skipVersionCheck, ...poolConfig } =
        typeof connection === 'string'
          ? {
              schema: undefined,
              skipVersionCheck: undefined,
              connectionString: connection,
            }
          : connection;
      this.schema = schema ?? DEFAULT_SCHEMA;
      this.skipVersionCheck = skipVersionCheck ?? false;
      // Validate early so a bad schema name fails fast (and before any DDL).
      const quotedSchema = quoteSchemaName(this.schema);
      // Pin every pooled connection's search_path to the schema so the `.sql`
      // command files use unqualified, portable names. Quoted to match the
      // migration's quoted CREATE SCHEMA (case-preserving).
      const searchPathOption = `-c search_path=${quotedSchema}`;
      const existingOptions = (poolConfig as { options?: string }).options;
      const resolvedConfig: PgPoolConfig = {
        ...poolConfig,
        options: existingOptions
          ? `${existingOptions} ${searchPathOption}`
          : searchPathOption,
      };
      this.pool = new pg.Pool(resolvedConfig);
      this.ownsPool = true;
      // Keep the means to build a dedicated LISTEN connection on demand.
      this.pgModule = pg;
      this.listenClientConfig = resolvedConfig;
    }

    // The pool emits 'error' for idle clients that drop; surface it but never
    // let it crash the process — hence the guarded {@link emitError} (a bare
    // `emit('error')` with no listeners throws).
    this.pool.on('error', err => this.emitError(err));
  }

  /**
   * Forwards an underlying pool / LISTEN-client error as this connection's
   * `'error'` event, but only when a listener is attached. `EventEmitter.emit`
   * throws when emitting `'error'` with no listeners, so an unguarded forward
   * would turn an idle-client error into a hard process crash. Mirrors the
   * guard in {@link RedisConnection}.
   */
  private emitError(err: Error): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', err);
    }
  }

  /**
   * Resolves once the pool is reachable and the schema is up to date.
   *
   * Idempotent and memoized: the migration runs exactly once per connection,
   * on a single dedicated client checked out of the pool (so the migration's
   * advisory lock and transaction share one session — see {@link runMigrations}).
   */
  async waitUntilReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.bootstrap();
    }
    return this.readyPromise;
  }

  private async bootstrap(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await runMigrations(client, this.schema, {
        skipVersionCheck: this.skipVersionCheck,
      });
    } finally {
      client.release();
    }
    // Defer so listeners attached synchronously after construction still fire.
    setTimeout(() => this.emit('ready'), 0);
  }

  /**
   * Returns the dedicated client used for `LISTEN`/`NOTIFY`, establishing it on
   * first use.
   *
   * When this connection owns the pool we use a *standalone* `pg.Client` (its
   * own dedicated TCP connection) so the long-lived `LISTEN` never consumes a
   * pool slot — this is what lets the query pool run at `max: 1` without
   * deadlocking. When the user supplied their own `pg.Pool` we check a client
   * out of it (so such pools should be sized `>= 2`).
   */
  async getListenClient(): Promise<PgListenClient> {
    // Memoize the establishment promise (not just the resolved client) so two
    // callers racing on the first use don't each open a connection — the
    // `await` below is exactly where a second caller would otherwise slip in.
    if (!this.listenClientPromise) {
      this.listenClientPromise = (async () => {
        if (this.pgModule && this.listenClientConfig) {
          const client = new this.pgModule.Client(this.listenClientConfig);
          await client.connect();
          client.on('error', err => this.emitError(err));
          this.listenClientIsStandalone = true;
          this.listenClient = client;
          return client;
        } else {
          const client = await this.pool.connect();
          client.on('error', err => this.emitError(err));
          this.listenClientIsStandalone = false;
          this.listenClient = client;
          return client;
        }
      })();
    }
    return this.listenClientPromise;
  }

  /**
   * Truthy once {@link PostgresConnection.close} has begun.
   */
  get isClosing(): Promise<void> | undefined {
    return this.closing;
  }

  /**
   * Closes the connection: releases the `LISTEN` client and (if owned) ends the
   * pool. Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (!this.closing) {
      this.closing = (async () => {
        // Await any in-flight establishment so we never leak a LISTEN client
        // whose `getListenClient` promise was still pending when close() ran.
        const client =
          this.listenClient ??
          (await this.listenClientPromise?.catch(
            (): PgListenClient | undefined => undefined,
          ));
        this.listenClientPromise = undefined;
        if (client) {
          client.removeAllListeners();
          if (this.listenClientIsStandalone) {
            // Standalone dedicated connection: end it outright.
            await (client as PgClient).end();
          } else {
            // Pooled client: return it to the pool.
            (client as PgPoolClient).release();
          }
          this.listenClient = undefined;
        }
        if (this.ownsPool) {
          await this.pool.end();
        }
        this.emit('close');
      })();
    }
    return this.closing;
  }

  /**
   * Forcibly tears down the connection. For PostgreSQL there is no distinct
   * "disconnect without waiting" semantics beyond closing, so this delegates to
   * {@link PostgresConnection.close}.
   */
  async disconnect(): Promise<void> {
    return this.close();
  }
}
