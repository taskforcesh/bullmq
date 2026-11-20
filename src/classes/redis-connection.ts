import { EventEmitter } from 'node:events';
import type { default as IORedis } from 'ioredis';
import { ConnectionOptions, RedisOptions, RedisClient } from '../interfaces';
import { IRedisClient } from '../interfaces/redis-client';
import {
  decreaseMaxListeners,
  increaseMaxListeners,
  isNotConnectionError,
  isRedisCluster,
  isRedisInstance,
  isRedisVersionLowerThan,
} from '../utils';
import { version as packageVersion } from '../version';
import * as scripts from '../scripts';
import { DatabaseType } from '../types';
import { createIORedisClient, isIRedisClient } from './ioredis-client';
import { createNodeRedisClient } from './node-redis-client';
import { createBunRedisClient } from './bun-redis-client';
import {
  ConnectionClosedError,
  CONNECTION_CLOSED_ERROR_MSG,
} from './errors/connection-closed-error';

const overrideMessage = [
  'BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null',
  'and will be overridden by BullMQ.',
].join(' ');

const deprecationMessage =
  'BullMQ: Your redis options maxRetriesPerRequest must be null.';

const clusterReconnectPromise = Symbol('bullmqClusterReconnectPromise');
const clusterPatchedForBlocking = Symbol('bullmqClusterPatchedForBlocking');
const clusterOriginalBzpopmin = Symbol('bullmqClusterOriginalBzpopmin');
const clusterWrappedBzpopmin = Symbol('bullmqClusterWrappedBzpopmin');
const clusterPatchRefCount = Symbol('bullmqClusterPatchRefCount');
const clusterClosingRefCount = Symbol('bullmqClusterClosingRefCount');

// Hard cap on a single cluster reconnect attempt. Without this, a hung
// `client.connect()` (e.g. ioredis Cluster cannot recover and slot refresh
// keeps retrying internally) leaves `clusterReconnectPromise` pinned forever
// and every subsequent bzpopmin call awaits the same dead promise, deadlocking
// the worker. 30s is comfortably above the default ioredis slotsRefreshTimeout
// while bounded enough that wedged workers recover within one or two ticks.
const DEFAULT_CLUSTER_RECONNECT_TIMEOUT_MS = 30_000;

// Hard cap on disconnect(wait: true) waiting for the client's 'end' event.
// ioredis only emits 'end' once it gives up retrying; calling `disconnect()`
// while the client is mid-`reconnecting` just tears down the current socket
// attempt and immediately schedules another one, so with an infinite (or
// long) retry strategy against an unreachable Redis, 'end' may never fire.
// Without this bound, close() (via whenCurrentJobsFinished ->
// disconnectBlocking -> disconnect) hangs forever instead of completing.
// See https://github.com/taskforcesh/bullmq/issues/4656.
const DEFAULT_DISCONNECT_TIMEOUT_MS = 30_000;

interface RedisCapabilities {
  canDoubleTimeout: boolean;
  canBlockFor1Ms: boolean;
}

interface BlockingClusterClient {
  [clusterReconnectPromise]?: Promise<void> | null;
  [clusterPatchedForBlocking]?: boolean;
  [clusterOriginalBzpopmin]?: BlockingClusterClient['bzpopmin'];
  [clusterWrappedBzpopmin]?: BlockingClusterClient['bzpopmin'];
  [clusterPatchRefCount]?: number;
  [clusterClosingRefCount]?: number;
  bzpopmin: (...args: any[]) => Promise<unknown>;
  connect: () => Promise<void>;
  disconnect: (reconnect?: boolean) => void;
  nodes?: () => unknown[];
  status?: string;
}

export interface RawCommand {
  content: string;
  name: string;
  keys: number;
}

type IORedisModule = { default: typeof IORedis };

/**
 * Lazily loads the optional `ioredis` driver. Users on another Redis driver
 * (node-redis, Bun built-in, …) or on the PostgreSQL backend never hit this
 * path, so they never need `ioredis` installed.
 *
 * Only reached when no {@link RedisConnection.clientFactory} is set and the
 * caller did not pass an already-constructed client instance. In native ESM
 * environments where `require` is unavailable, callers should provide a client
 * instance or a `clientFactory` instead.
 */
function loadIORedis(): typeof IORedis {
  try {
    if (typeof require === 'function') {
      const mod = require('ioredis') as IORedisModule | typeof IORedis;
      // ioredis exports the constructor both as the module itself (CJS) and
      // under `default` (ESM interop); normalise to the constructor.
      return (mod as IORedisModule).default ?? (mod as typeof IORedis);
    }
  } catch {
    // Fall through to the friendly error below.
  }
  throw new Error(
    "BullMQ could not load the optional 'ioredis' package. " +
      'Install it with `npm install ioredis`, or provide a different Redis ' +
      'client instance (e.g. node-redis) via the connection option. In a ' +
      'native ESM environment, pass an already-constructed client instance ' +
      'instead of connection options.',
  );
}

/**
 * Wraps a raw client instance passed through the `connection` option in the
 * matching {@link IRedisClient} adapter, auto-detecting the underlying driver.
 *
 * This lets consumers pass a native node-redis or Bun client directly (without
 * manually calling `createNodeRedisClient` / `createBunRedisClient` or setting a
 * global {@link RedisConnection.clientFactory}), so those users never need
 * `ioredis` installed. ioredis instances keep their existing code path, so the
 * behaviour is fully backwards compatible.
 *
 * Detection is purely structural (no driver package is imported), keying off
 * markers that are unique to each client:
 *   - ioredis exposes `defineCommand` (used to register Lua scripts);
 *     node-redis and Bun do not.
 *   - node-redis (`@redis/client`) exposes `sendCommand` plus `isOpen`/`isReady`.
 *   - Bun's built-in `RedisClient` exposes `send` plus a `connected` flag.
 */
function wrapRedisInstance(instance: any): IRedisClient {
  // Already an adapted IRedisClient (ioredis proxy, node-redis, Bun, or a
  // custom implementation) — use as-is.
  if (isIRedisClient(instance)) {
    return instance;
  }

  const hasDefineCommand = typeof instance.defineCommand === 'function';

  // node-redis (@redis/client): `sendCommand` + `isOpen`/`isReady`, and no
  // ioredis-style `defineCommand`.
  if (
    !hasDefineCommand &&
    typeof instance.sendCommand === 'function' &&
    ('isOpen' in instance || 'isReady' in instance)
  ) {
    return createNodeRedisClient(instance);
  }

  // Bun's built-in RedisClient: `send` + `connected`, and no `defineCommand`.
  if (
    !hasDefineCommand &&
    typeof instance.send === 'function' &&
    'connected' in instance
  ) {
    return createBunRedisClient(instance);
  }

  // Default: treat as an ioredis instance (backwards compatible).
  return createIORedisClient(instance);
}

export class RedisConnection extends EventEmitter {
  static minimumVersion = '5.0.0';
  static recommendedMinimumVersion = '6.2.0';

  /**
   * Optional factory that creates an {@link IRedisClient} from raw options.
   *
   * When set, {@link RedisConnection} will call this factory instead of
   * creating an ioredis client internally.  This allows swapping the Redis
   * driver (e.g. node-redis, Bun built-in) without changing consumer code.
   *
   * The factory receives the merged {@link RedisOptions} and must return
   * an **already-augmented** {@link IRedisClient} (e.g. via
   * `createNodeRedisClient`).
   *
   * @example
   * ```ts
   * import { createClient } from 'redis';
   * import { RedisConnection, createNodeRedisClient } from 'bullmq';
   *
   * RedisConnection.clientFactory = (opts) => {
   *   const raw = createClient({ url: `redis://${opts.host ?? '127.0.0.1'}:${opts.port ?? 6379}` });
   *   return createNodeRedisClient(raw);
   * };
   * ```
   */
  static clientFactory?: (opts: RedisOptions) => IRedisClient;

  closing: boolean;
  capabilities: RedisCapabilities = {
    canDoubleTimeout: false,
    canBlockFor1Ms: true,
  };

  status: 'initializing' | 'ready' | 'closing' | 'closed' = 'initializing';
  private dbType: DatabaseType = 'redis';

  protected _client: RedisClient;

  private readonly opts: RedisOptions;
  // Not readonly: reconnect() replaces this with a fresh resolved promise
  // once a connection that never settled successfully (see its own comment)
  // comes back up, so the `client` getter stops handing every future caller
  // the same stale pending/rejected promise.
  private initializing: Promise<RedisClient>;

  private version: string;
  protected packageVersion = packageVersion;
  private skipVersionCheck: boolean;
  private handleClientError: (e: Error) => void;
  private handleClientClose: () => void;
  private handleClientReady: () => void;
  private patchedBlockingClusterClient?: BlockingClusterClient;
  private disabledBlockingClusterReconnect = false;

  constructor(
    opts: ConnectionOptions,
    private readonly extraOptions?: {
      shared?: boolean;
      blocking?: boolean;
      skipVersionCheck?: boolean;
      skipWaitingForReady?: boolean;
      clusterReconnectTimeoutMs?: number;
      disconnectTimeoutMs?: number;
    },
  ) {
    super();

    // Set extra options defaults
    this.extraOptions = {
      shared: false,
      blocking: true,
      skipVersionCheck: false,
      skipWaitingForReady: false,
      clusterReconnectTimeoutMs: DEFAULT_CLUSTER_RECONNECT_TIMEOUT_MS,
      disconnectTimeoutMs: DEFAULT_DISCONNECT_TIMEOUT_MS,
      ...extraOptions,
    };

    if (!isRedisInstance(opts)) {
      this.checkBlockingOptions(overrideMessage, opts);

      this.opts = {
        port: 6379,
        host: '127.0.0.1',
        retryStrategy: function (times: number) {
          return Math.max(Math.min(Math.exp(times), 20000), 1000);
        },
        ...opts,
      };

      if (this.extraOptions.blocking) {
        this.opts.maxRetriesPerRequest = null;
      }
    } else {
      // Wrap raw client instances in the matching IRedisClient adapter,
      // auto-detecting the driver (ioredis / node-redis / Bun) so callers can
      // pass a native client directly without setting a clientFactory.
      this._client = wrapRedisInstance(opts);

      // Test if the redis instance is using keyPrefix
      // and if so, throw an error.
      if (this._client.options.keyPrefix) {
        throw new Error(
          'BullMQ: ioredis does not support ioredis prefixes, use the prefix option instead.',
        );
      }

      if (this._client.isCluster) {
        this.opts = this._client.options.redisOptions;
      } else {
        this.opts = this._client.options;
      }

      this.checkBlockingOptions(deprecationMessage, this.opts, true);
    }

    this.skipVersionCheck =
      extraOptions?.skipVersionCheck ||
      !!(this.opts && this.opts.skipVersionCheck);

    this.handleClientError = (err: Error): void => {
      this.emit('error', err);
    };

    this.handleClientClose = (): void => {
      this.emit('close');
    };

    this.handleClientReady = (): void => {
      this.emit('ready');
    };

    this.initializing = this.init();
    this.initializing.catch(err => {
      // Only emit if there is an `error` listener attached. `EventEmitter.emit`
      // throws when emitting `error` with no listeners, which would surface as
      // an unhandled rejection — e.g. when the connection is force-closed during
      // shutdown while its version-check `INFO` command is still in flight and
      // rejects with "Connection is closed". The init error is still propagated
      // to anything awaiting `initializing` (the `client` getter and `close`).
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
    });
  }

  private checkBlockingOptions(
    msg: string,
    options?: RedisOptions,
    throwError = false,
  ) {
    if (this.extraOptions.blocking && options && options.maxRetriesPerRequest) {
      if (throwError) {
        throw new Error(msg);
      } else {
        console.error(msg);
      }
    }
  }

  /**
   * Waits for a redis client to be ready.
   * @param client - Redis client to wait for.
   */
  static async waitUntilReady(client: RedisClient): Promise<void> {
    if (client.status === 'ready') {
      return;
    }

    // ioredis Cluster reports 'connect' as its connected status instead of
    // 'ready' that standalone Redis uses. Treat it as already connected so we
    // don't hang waiting for a 'ready' event that will never fire and end up
    // throwing a spurious "Connection is closed" error during disconnect.
    if (client.status === 'connect' && isRedisCluster(client)) {
      return;
    }

    if (client.status === 'wait') {
      return client.connect();
    }

    if (client.status === 'end') {
      throw new ConnectionClosedError(CONNECTION_CLOSED_ERROR_MSG);
    }

    let handleReady: () => void;
    let handleEnd: () => void;
    let handleError: (e: Error) => void;
    try {
      await new Promise<void>((resolve, reject) => {
        let lastError: Error;

        handleError = (err: Error) => {
          lastError = err;
        };

        handleReady = () => {
          resolve();
        };

        handleEnd = () => {
          if (client.status !== 'end') {
            reject(
              lastError ||
                new ConnectionClosedError(CONNECTION_CLOSED_ERROR_MSG),
            );
          } else {
            if (lastError) {
              reject(lastError);
            } else {
              // when custom 'end' status is set we already closed
              resolve();
            }
          }
        };

        increaseMaxListeners(client, 3);

        client.once('ready', handleReady);
        client.on('end', handleEnd);
        client.once('error', handleError);
      });
    } finally {
      client.removeListener('end', handleEnd);
      client.removeListener('error', handleError);
      client.removeListener('ready', handleReady);

      decreaseMaxListeners(client, 3);
    }
  }

  get client(): Promise<RedisClient> {
    return this.initializing;
  }

  protected loadCommands(
    packageVersion: string,
    providedScripts?: Record<string, RawCommand>,
  ): void {
    const finalScripts =
      providedScripts || (scripts as Record<string, RawCommand>);
    for (const property in finalScripts as Record<string, RawCommand>) {
      // Only define the command if not already defined
      const commandName = `${finalScripts[property].name}:${packageVersion}`;
      if (!(<any>this._client)[commandName]) {
        this._client.defineCommand(commandName, {
          numberOfKeys: finalScripts[property].keys,
          lua: finalScripts[property].content,
        });
      }
    }
  }

  private async init() {
    if (!this._client) {
      if (RedisConnection.clientFactory) {
        this._client = RedisConnection.clientFactory(this.opts);
      } else {
        const { url, ...rest } = this.opts;
        const IORedisCtor = loadIORedis();
        const ioredisClient = url
          ? new IORedisCtor(url, rest)
          : new IORedisCtor(rest);
        this._client = createIORedisClient(ioredisClient);
      }
    }

    increaseMaxListeners(this._client, 3);

    this._client.on('error', this.handleClientError);
    // ioredis treats connection errors as a different event ('close')
    this._client.on('close', this.handleClientClose);

    this._client.on('ready', this.handleClientReady);

    this.patchBlockingClusterClient();

    if (!this.extraOptions.skipWaitingForReady) {
      await RedisConnection.waitUntilReady(this._client);
    }

    await this.completeInitialization();

    return this._client;
  }

  // Everything init() still needs to do once the client is confirmed ready:
  // register BullMQ's Lua commands and finish Redis version/capability
  // discovery. Split out from init() so reconnect() can re-run exactly this
  // part - and only this part - on a client whose original init() call
  // returned (via waitUntilReady() rejecting, e.g. because Redis was
  // unreachable) before ever reaching it. Re-running the earlier parts of
  // init() (client creation, event listener registration) would either be a
  // no-op or, worse, register duplicate listeners, so this is deliberately
  // the smallest idempotent slice: loadCommands() only defines a command if
  // it isn't already defined, and getRedisVersionAndType() is a plain
  // re-fetch with no side effects of its own.
  // See https://github.com/taskforcesh/bullmq/issues/4656.
  private async completeInitialization(): Promise<void> {
    this.loadCommands(this.packageVersion);

    if (this._client['status'] !== 'end') {
      const versionResult = await this.getRedisVersionAndType();
      this.version = versionResult.version;
      this.dbType = versionResult.databaseType;

      if (this.skipVersionCheck !== true && !this.closing) {
        if (
          isRedisVersionLowerThan(
            this.version,
            RedisConnection.minimumVersion,
            this.dbType,
          )
        ) {
          throw new Error(
            `Redis version needs to be greater or equal than ${RedisConnection.minimumVersion} ` +
              `Current: ${this.version}`,
          );
        }

        if (
          isRedisVersionLowerThan(
            this.version,
            RedisConnection.recommendedMinimumVersion,
            this.dbType,
          )
        ) {
          console.warn(
            `It is highly recommended to use a minimum Redis version of ${RedisConnection.recommendedMinimumVersion}
             Current: ${this.version}`,
          );
        }
      }

      this.capabilities = {
        canDoubleTimeout: !isRedisVersionLowerThan(
          this.version,
          '6.0.0',
          this.dbType,
        ),
        canBlockFor1Ms: !isRedisVersionLowerThan(
          this.version,
          '7.0.8',
          this.dbType,
        ),
      };

      this.status = 'ready';
    }
  }

  private patchBlockingClusterClient(): void {
    const client = this._client;
    const blockingClient = client as unknown as BlockingClusterClient;
    if (
      !this.extraOptions.blocking ||
      !isRedisCluster(client) ||
      typeof blockingClient.bzpopmin !== 'function'
    ) {
      return;
    }

    const reconnectTimeoutMs =
      this.extraOptions.clusterReconnectTimeoutMs ??
      DEFAULT_CLUSTER_RECONNECT_TIMEOUT_MS;

    blockingClient[clusterPatchRefCount] =
      (blockingClient[clusterPatchRefCount] || 0) + 1;
    this.patchedBlockingClusterClient = blockingClient;

    if (blockingClient[clusterPatchedForBlocking]) {
      return;
    }

    const bzpopmin = blockingClient.bzpopmin;
    const wrappedBzpopmin = (...args: any[]) =>
      RedisConnection.runWithClusterRecovery(
        blockingClient,
        reconnectTimeoutMs,
        () => bzpopmin.apply(blockingClient, args),
      );

    blockingClient[clusterOriginalBzpopmin] = bzpopmin;
    blockingClient[clusterWrappedBzpopmin] = wrappedBzpopmin;
    blockingClient[clusterPatchedForBlocking] = true;
    blockingClient.bzpopmin = wrappedBzpopmin;
  }

  /**
   * Runs a command of a blocking connection with the recovery that `bzpopmin`
   * gets on an ioredis Cluster: an empty node pool is reconnected before the
   * command, and a cluster left unusable by its failure is reconnected before
   * rethrowing it. Other connections just run the command.
   */
  runWithClusterRecovery<T>(command: () => Promise<T>): Promise<T> {
    const client = this.patchedBlockingClusterClient;
    if (!client) {
      return command();
    }
    return RedisConnection.runWithClusterRecovery(
      client,
      this.extraOptions.clusterReconnectTimeoutMs ??
        DEFAULT_CLUSTER_RECONNECT_TIMEOUT_MS,
      command,
    );
  }

  private static async runWithClusterRecovery<T>(
    client: BlockingClusterClient,
    timeoutMs: number,
    command: () => Promise<T>,
  ): Promise<T> {
    await RedisConnection.reconnectClusterIfNeeded(client, timeoutMs);

    try {
      return await command();
    } catch (error) {
      const commandError = error as Error;
      if (
        RedisConnection.shouldReconnectClusterAfterError(client, commandError)
      ) {
        try {
          await RedisConnection.reconnectCluster(client, timeoutMs);
        } catch {
          // Preserve the original command failure if best-effort recovery fails.
        }
      }
      throw commandError;
    }
  }

  private disableBlockingClusterReconnect(): void {
    const client = this.patchedBlockingClusterClient;
    if (!client || this.disabledBlockingClusterReconnect) {
      return;
    }

    client[clusterClosingRefCount] = (client[clusterClosingRefCount] || 0) + 1;
    this.disabledBlockingClusterReconnect = true;
  }

  private releaseBlockingClusterClientPatch(): void {
    const client = this.patchedBlockingClusterClient;
    if (!client) {
      return;
    }

    if (this.disabledBlockingClusterReconnect) {
      const closingRefCount = (client[clusterClosingRefCount] || 1) - 1;
      if (closingRefCount > 0) {
        client[clusterClosingRefCount] = closingRefCount;
      } else {
        delete client[clusterClosingRefCount];
      }
      this.disabledBlockingClusterReconnect = false;
    }

    const patchRefCount = (client[clusterPatchRefCount] || 1) - 1;
    if (patchRefCount > 0) {
      client[clusterPatchRefCount] = patchRefCount;
      this.patchedBlockingClusterClient = undefined;
      return;
    }

    if (
      client[clusterOriginalBzpopmin] &&
      client.bzpopmin === client[clusterWrappedBzpopmin]
    ) {
      client.bzpopmin = client[clusterOriginalBzpopmin];
    }

    delete client[clusterPatchRefCount];
    delete client[clusterClosingRefCount];
    delete client[clusterOriginalBzpopmin];
    delete client[clusterWrappedBzpopmin];
    delete client[clusterPatchedForBlocking];
    this.patchedBlockingClusterClient = undefined;
  }

  private static isClusterWithEmptyNodes(
    client: BlockingClusterClient,
  ): boolean {
    return typeof client.nodes === 'function' && client.nodes().length === 0;
  }

  private static isReconnectingDisabled(
    client: BlockingClusterClient,
  ): boolean {
    const patchRefCount = client[clusterPatchRefCount] || 0;
    const closingRefCount = client[clusterClosingRefCount] || 0;

    return (
      patchRefCount === 0 ||
      closingRefCount >= patchRefCount ||
      client.status === 'end' ||
      client.status === 'closing'
    );
  }

  private static async reconnectClusterIfNeeded(
    client: BlockingClusterClient,
    timeoutMs: number,
  ): Promise<void> {
    if (
      !RedisConnection.isReconnectingDisabled(client) &&
      RedisConnection.isClusterWithEmptyNodes(client)
    ) {
      await RedisConnection.reconnectCluster(client, timeoutMs);
    }
  }

  private static shouldReconnectClusterAfterError(
    client: BlockingClusterClient,
    error: Error,
  ): boolean {
    if (RedisConnection.isReconnectingDisabled(client)) {
      return false;
    }

    const message = [
      error.message,
      (error as any).cause?.message,
      (error as any).lastNodeError?.message,
    ].join(' ');

    return (
      RedisConnection.isClusterWithEmptyNodes(client) ||
      /Command timed out|Failed to refresh slots cache/i.test(message)
    );
  }

  private static async reconnectCluster(
    client: BlockingClusterClient,
    timeoutMs: number,
  ): Promise<void> {
    if (RedisConnection.isReconnectingDisabled(client)) {
      return;
    }

    if (!client[clusterReconnectPromise]) {
      client[clusterReconnectPromise] =
        RedisConnection.connectClusterWithTimeout(client, timeoutMs).finally(
          () => {
            client[clusterReconnectPromise] = null;
          },
        );
    }

    await client[clusterReconnectPromise];
  }

  // Disconnects and reconnects a cluster client, racing connect() against a
  // hard cap so a hung reconnect cannot pin `clusterReconnectPromise`
  // indefinitely. On timeout, the underlying connect() is left running
  // (ioredis Cluster handles its own retry/state); we simply stop awaiting it.
  // The next bzpopmin call's `reconnectClusterIfNeeded` check will trigger a
  // fresh reconnect if the pool is still empty.
  private static async connectClusterWithTimeout(
    client: BlockingClusterClient,
    timeoutMs: number,
  ): Promise<void> {
    client.disconnect(false);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(
              new ConnectionClosedError(
                `BullMQ: cluster reconnect timed out after ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);
          // Don't keep the event loop alive solely for this timer.
          timeoutHandle.unref?.();
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async disconnect(wait = true): Promise<void> {
    // If the connection never reached 'ready' (e.g. Redis is unreachable and
    // the client is stuck in its reconnect loop), `this.client` - which
    // resolves from `this.initializing` - may never settle. `close()` already
    // avoids this trap for the main connection by acting on `this._client`
    // directly when `status === 'initializing'`; do the same here so a
    // never-connected blocking connection can still be torn down instead of
    // hanging forever. See https://github.com/taskforcesh/bullmq/issues/4656.
    if (this.status === 'initializing') {
      const client = this._client;
      this.initializing?.catch(() => {});

      // `status === 'initializing'` only means `init()` hasn't resolved yet
      // - the live client underneath it may already be 'ready' (e.g. still
      // running its version-check INFO command) or further along than
      // 'wait'/'connecting'/'reconnecting'. Only a live socket ('ready', an
      // actual in-flight 'connecting' attempt, or 'connect' for a cluster)
      // has anything async to wait for: ioredis's disconnect() while
      // 'wait'/'reconnecting' just cancels the pending retry timer - there
      // is no open stream yet to close, so it never emits 'end' at all, and
      // waiting for it here would mean waiting out the full disconnect
      // timeout for nothing. Only in the live-socket case can an immediate
      // `reconnect()` right after race the teardown and observe stale
      // pre-disconnect status, so only that case needs `wait: true` to bound
      // a real wait for 'end'/'error'.
      const hasLiveSocket =
        !!client &&
        (client.status === 'ready' ||
          client.status === 'connecting' ||
          (client.status === 'connect' && isRedisCluster(client)));

      if (!client || !wait || !hasLiveSocket) {
        client?.disconnect();
        return;
      }

      let _resolve, _reject;
      const disconnecting = new Promise<void>((resolve, reject) => {
        increaseMaxListeners(client, 2);
        client.once('end', resolve);
        client.once('error', reject);
        _resolve = resolve;
        _reject = reject;
      });

      client.disconnect();

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          disconnecting,
          new Promise<void>(resolve => {
            timeoutHandle = setTimeout(
              resolve,
              this.extraOptions.disconnectTimeoutMs ??
                DEFAULT_DISCONNECT_TIMEOUT_MS,
            );
            timeoutHandle.unref?.();
          }),
        ]).catch(() => {});
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        decreaseMaxListeners(client, 2);
        client.removeListener('end', _resolve);
        client.removeListener('error', _reject);
      }
      return;
    }

    const client = await this.client;
    if (client.status !== 'end') {
      // A connection that dropped out after being 'ready' and is now stuck
      // reconnecting (e.g. Redis became unreachable mid-flight) has no live
      // socket to close: ioredis's disconnect() while 'wait'/'connecting'/
      // 'reconnecting' just cancels the pending retry timer and never emits
      // 'end' at all (there is nothing open to close), so waiting for it
      // here would mean waiting out the full disconnect timeout for
      // nothing. Only a live socket - 'ready', 'connecting' (an actual
      // in-flight connection attempt), or 'connect' for a cluster - has
      // anything async to wait for.
      // See https://github.com/taskforcesh/bullmq/issues/4656.
      const hasLiveSocket =
        client.status === 'ready' ||
        client.status === 'connecting' ||
        (client.status === 'connect' && isRedisCluster(client));

      if (!wait || !hasLiveSocket) {
        return client.disconnect();
      }

      let _resolve, _reject;
      const disconnecting = new Promise<void>((resolve, reject) => {
        increaseMaxListeners(client, 2);

        client.once('end', resolve);
        client.once('error', reject);
        _resolve = resolve;
        _reject = reject;
      });

      client.disconnect();

      // Belt-and-braces bound: even with a live socket, `disconnect()` can
      // race an in-progress reconnect attempt and leave `'end'`/`'error'`
      // unfired (see the linked issue's cluster/reconnect variant). Don't
      // let that leave this promise - and therefore callers like
      // Worker.close() - pending forever.
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          disconnecting,
          new Promise<void>(resolve => {
            timeoutHandle = setTimeout(
              resolve,
              this.extraOptions.disconnectTimeoutMs ??
                DEFAULT_DISCONNECT_TIMEOUT_MS,
            );
            // Don't keep the event loop alive solely for this timer.
            timeoutHandle.unref?.();
          }),
        ]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        decreaseMaxListeners(client, 2);

        client.removeListener('end', _resolve);
        client.removeListener('error', _reject);
      }
    }
  }

  async reconnect(): Promise<void> {
    // `disconnect()` may have torn down a connection that never reached
    // 'ready' (see its own comment) by acting on `this._client` directly
    // without ever letting `this.initializing` settle successfully - it may
    // still be pending (not just about to reject), so plainly `await`ing
    // `this.client` here could hang forever instead of giving us a client to
    // reconnect. `this._client` is always the same underlying client that
    // `this.initializing` is (or was) initializing - `init()` never swaps it
    // for a different instance after construction - so operating on it
    // directly is always at least as current and never less safe. Prefer it
    // whenever it exists so a caller like `pause()`, which disconnects and
    // then immediately reconnects, isn't stuck awaiting a promise that may
    // never resolve to a usable client.
    // See https://github.com/taskforcesh/bullmq/issues/4656.
    const client: RedisClient = this._client ?? (await this.client);

    for (;;) {
      if (
        client.status === 'ready' ||
        (client.status === 'connect' && isRedisCluster(client))
      ) {
        await this.repairInitializing(client);
        return;
      }

      if (client.status === 'wait' || client.status === 'end') {
        await client.connect();
        await this.repairInitializing(client);
        return;
      }

      try {
        await RedisConnection.waitUntilReady(client);
        // `waitUntilReady()` can resolve successfully even though the client
        // reached a terminal `'end'` state rather than `'ready'` (it treats a
        // clean close with no prior error as success, not failure - see its
        // own `handleEnd` logic). Don't assume resolution means ready: loop
        // back around so the `'wait'/'end'` branch above calls `connect()`
        // when that's what actually happened.
        continue;
      } catch (error) {
        if (
          !['end', 'connecting', 'connect', 'reconnecting'].includes(
            client.status,
          )
        ) {
          throw error;
        }
      }
    }
  }

  // After a successful reconnect driven directly off `this._client` (see
  // `reconnect()`), make sure the public `client` getter - which always
  // returns `this.initializing` - reflects reality for every future caller,
  // not just this one call. Without this, a connection that disconnect()
  // tore down before it ever reached 'ready' would leave `this.initializing`
  // permanently pending/rejected even after reconnect() brings the live
  // client back up, so every later `await this.client` (close(), other
  // commands) would still hang or throw on the stale promise.
  //
  // The original init() may itself have returned early - its
  // waitUntilReady() call can reject (e.g. Redis was unreachable at the
  // time) before init() ever reaches loadCommands() or version/capability
  // discovery, in which case `this.version` is still unset. A client in that
  // state is "ready" at the ioredis level but was never fully initialized by
  // BullMQ, so publishing it as-is would let callers run Lua commands that
  // were never defined on it. Detect that case via the unset `version` and
  // complete the same initialization init() would have done, before
  // publishing the client as ready.
  // See https://github.com/taskforcesh/bullmq/issues/4656.
  private async repairInitializing(client: RedisClient): Promise<void> {
    if (this.version === undefined) {
      await this.completeInitialization();
    }

    if (this.status !== 'closing' && this.status !== 'closed') {
      this.status = 'ready';
    }
    this.initializing = Promise.resolve(client);
    // Swallow any rejection from the promise we're replacing so it doesn't
    // surface as an unhandled rejection once nothing awaits it anymore.
    this.initializing.catch(() => {});
  }

  async close(force = false): Promise<void> {
    if (!this.closing) {
      const status = this.status;
      this.status = 'closing';
      this.closing = true;
      this.disableBlockingClusterReconnect();

      try {
        if (status === 'ready') {
          // Not sure if we need to wait for this
          await this.initializing;
        }
        if (!this.extraOptions.shared) {
          // `quit()` only resolves promptly when ioredis can actually flush
          // it: if the live client isn't ready (never connected, or lost the
          // connection and is stuck reconnecting), `quit()` either goes
          // through ioredis's offline-queue fast path (only taken when that
          // queue is otherwise empty) or, if any other command is already
          // queued ahead of it (e.g. a job fetch the worker issued before
          // close() was called), it queues behind that command and may never
          // resolve while the connection stays unreachable. Force-disconnect
          // in that case instead of risking an unbounded wait.
          // See https://github.com/taskforcesh/bullmq/issues/4656.
          const liveStatus = this._client['status'];
          const isLiveReady =
            liveStatus === 'ready' ||
            (liveStatus === 'connect' && isRedisCluster(this._client));

          if (status == 'initializing' || force || !isLiveReady) {
            // If we have not still connected to Redis, we need to disconnect.
            this._client.disconnect();
            // Suppress any rejection from the in-flight init() so it doesn't
            // become an unhandled rejection after we close the connection.
            this.initializing?.catch(() => {});
          } else {
            await this._client.quit();
          }
          // As IORedis does not update this status properly, we do it ourselves.
          this._client['status'] = 'end';
        }
      } catch (error) {
        if (isNotConnectionError(error as Error)) {
          throw error;
        }
      } finally {
        this.releaseBlockingClusterClientPatch();
        this._client.off('error', this.handleClientError);
        this._client.off('close', this.handleClientClose);
        this._client.off('ready', this.handleClientReady);

        decreaseMaxListeners(this._client, 3);

        this.removeAllListeners();
        this.status = 'closed';
      }
    }
  }

  private async getRedisVersionAndType(): Promise<{
    version: string;
    databaseType: DatabaseType;
  }> {
    if (this.skipVersionCheck) {
      return {
        version: RedisConnection.minimumVersion,
        databaseType: 'redis',
      };
    }

    const doc = await this._client.info();
    const redisPrefix = 'redis_version:';
    const maxMemoryPolicyPrefix = 'maxmemory_policy:';
    const lines = doc.split(/\r?\n/);
    let redisVersion;
    let databaseType: DatabaseType = 'redis';

    // Detect database type from server info
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for Dragonfly
      if (
        line.includes('dragonfly_version:') ||
        line.includes('server:Dragonfly')
      ) {
        databaseType = 'dragonfly';
        // For Dragonfly, extract version from dragonfly_version field
        if (line.indexOf('dragonfly_version:') === 0) {
          redisVersion = line.substr('dragonfly_version:'.length);
        }
      }
      // Check for Valkey
      else if (
        line.includes('valkey_version:') ||
        line.includes('server:Valkey')
      ) {
        databaseType = 'valkey';
        // For Valkey, extract version from valkey_version field
        if (line.indexOf('valkey_version:') === 0) {
          redisVersion = line.substr('valkey_version:'.length);
        }
      }
      // Standard Redis version detection
      else if (line.indexOf(redisPrefix) === 0) {
        redisVersion = line.substr(redisPrefix.length);
        // Keep Redis as default unless we find evidence of other databases above
        if (databaseType === 'redis') {
          databaseType = 'redis';
        }
      }

      if (line.indexOf(maxMemoryPolicyPrefix) === 0) {
        const maxMemoryPolicy = line.substr(maxMemoryPolicyPrefix.length);
        if (maxMemoryPolicy !== 'noeviction') {
          console.warn(
            `IMPORTANT! Eviction policy is ${maxMemoryPolicy}. It should be "noeviction"`,
          );
        }
      }
    }

    // Fallback version detection if specific database version field wasn't found
    if (!redisVersion) {
      // Try to find any version field as fallback
      for (const line of lines) {
        if (line.includes('version:')) {
          const parts = line.split(':');
          if (parts.length >= 2) {
            redisVersion = parts[1];
            break;
          }
        }
      }
    }

    return {
      version: redisVersion || RedisConnection.minimumVersion,
      databaseType,
    };
  }

  get redisVersion(): string {
    return this.version;
  }

  get databaseType(): DatabaseType {
    return this.dbType;
  }
}
