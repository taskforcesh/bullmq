import { EventEmitter } from 'events';
import { default as IORedis } from 'ioredis';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { CONNECTION_CLOSED_ERROR_MSG } from 'ioredis/built/utils';
import { ConnectionOptions, RedisOptions, RedisClient } from '../interfaces';
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

export class RedisConnection extends EventEmitter {
  static minimumVersion = '5.0.0';
  static recommendedMinimumVersion = '6.2.0';

  closing: boolean;
  capabilities: RedisCapabilities = {
    canDoubleTimeout: false,
    canBlockFor1Ms: true,
  };

  status: 'initializing' | 'ready' | 'closing' | 'closed' = 'initializing';
  private dbType: DatabaseType = 'redis';

  protected _client: RedisClient;

  private readonly opts: RedisOptions;
  private readonly initializing: Promise<RedisClient>;

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
    },
  ) {
    super();

    // Set extra options defaults
    this.extraOptions = {
      shared: false,
      blocking: true,
      skipVersionCheck: false,
      skipWaitingForReady: false,
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
      this._client = opts;

      // Test if the redis instance is using keyPrefix
      // and if so, throw an error.
      if (this._client.options.keyPrefix) {
        throw new Error(
          'BullMQ: ioredis does not support ioredis prefixes, use the prefix option instead.',
        );
      }

      if (isRedisCluster(this._client)) {
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
    this.initializing.catch(err => this.emit('error', err));
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
   * @param redis - client
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
      throw new Error(CONNECTION_CLOSED_ERROR_MSG);
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
            reject(lastError || new Error(CONNECTION_CLOSED_ERROR_MSG));
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
        (<any>this._client).defineCommand(commandName, {
          numberOfKeys: finalScripts[property].keys,
          lua: finalScripts[property].content,
        });
      }
    }
  }

  private async init() {
    if (!this._client) {
      const { url, ...rest } = this.opts;
      this._client = url ? new IORedis(url, rest) : new IORedis(rest);
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

    return this._client;
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

    blockingClient[clusterPatchRefCount] =
      (blockingClient[clusterPatchRefCount] || 0) + 1;
    this.patchedBlockingClusterClient = blockingClient;

    if (blockingClient[clusterPatchedForBlocking]) {
      return;
    }

    const bzpopmin = blockingClient.bzpopmin;
    const wrappedBzpopmin = async (...args: any[]) => {
      await RedisConnection.reconnectClusterIfNeeded(blockingClient);

      try {
        return await bzpopmin.apply(blockingClient, args);
      } catch (error) {
        const commandError = error as Error;
        if (
          RedisConnection.shouldReconnectClusterAfterError(
            blockingClient,
            commandError,
          )
        ) {
          try {
            await RedisConnection.reconnectCluster(blockingClient);
          } catch {
            // Preserve the original command failure if best-effort recovery fails.
          }
        }
        throw commandError;
      }
    };

    blockingClient[clusterOriginalBzpopmin] = bzpopmin;
    blockingClient[clusterWrappedBzpopmin] = wrappedBzpopmin;
    blockingClient[clusterPatchedForBlocking] = true;
    blockingClient.bzpopmin = wrappedBzpopmin;
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
  ): Promise<void> {
    if (
      !RedisConnection.isReconnectingDisabled(client) &&
      RedisConnection.isClusterWithEmptyNodes(client)
    ) {
      await RedisConnection.reconnectCluster(client);
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
  ): Promise<void> {
    if (RedisConnection.isReconnectingDisabled(client)) {
      return;
    }

    if (!client[clusterReconnectPromise]) {
      client[clusterReconnectPromise] = (async () => {
        client.disconnect(false);
        await client.connect();
      })().finally(() => {
        client[clusterReconnectPromise] = null;
      });
    }

    await client[clusterReconnectPromise];
  }

  async disconnect(wait = true): Promise<void> {
    const client = await this.client;
    if (client.status !== 'end') {
      let _resolve, _reject;

      if (!wait) {
        return client.disconnect();
      }

      const disconnecting = new Promise<void>((resolve, reject) => {
        increaseMaxListeners(client, 2);

        client.once('end', resolve);
        client.once('error', reject);
        _resolve = resolve;
        _reject = reject;
      });

      client.disconnect();

      try {
        await disconnecting;
      } finally {
        decreaseMaxListeners(client, 2);

        client.removeListener('end', _resolve);
        client.removeListener('error', _reject);
      }
    }
  }

  async reconnect(): Promise<void> {
    const client = await this.client;
    return client.connect();
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
          if (status == 'initializing' || force) {
            // If we have not still connected to Redis, we need to disconnect.
            this._client.disconnect();
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
