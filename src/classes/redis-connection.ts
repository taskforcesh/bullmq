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

const overrideMessage = [
  'BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null',
  'and will be overridden by BullMQ.',
].join(' ');

const deprecationMessage =
  'BullMQ: Your redis options maxRetriesPerRequest must be null.';

interface RedisCapabilities {
  canDoubleTimeout: boolean;
  canBlockFor1Ms: boolean;
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

  protected _client: RedisClient;

  private readonly opts: RedisOptions;
  private readonly initializing: Promise<RedisClient>;

  private version: string;
  protected packageVersion = packageVersion;
  private skipVersionCheck: boolean;
  private handleClientError: (e: Error) => void;
  private handleClientClose: () => void;
  private handleClientReady: () => void;

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
              // when custon 'end' status is set we already closed
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

    if (!this.extraOptions.skipWaitingForReady) {
      await RedisConnection.waitUntilReady(this._client);
    }

    this.loadCommands(this.packageVersion);

    if (this._client['status'] !== 'end') {
      this.version = await this.getRedisVersion();
      if (this.skipVersionCheck !== true && !this.closing) {
        if (
          isRedisVersionLowerThan(this.version, RedisConnection.minimumVersion)
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
          )
        ) {
          console.warn(
            `It is highly recommended to use a minimum Redis version of ${RedisConnection.recommendedMinimumVersion}
             Current: ${this.version}`,
          );
        }
      }

      this.capabilities = {
        canDoubleTimeout: !isRedisVersionLowerThan(this.version, '6.0.0'),
        canBlockFor1Ms: !isRedisVersionLowerThan(this.version, '7.0.8'),
      };

      this.status = 'ready';
    }

    return this._client;
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
        this._client.off('error', this.handleClientError);
        this._client.off('close', this.handleClientClose);
        this._client.off('ready', this.handleClientReady);

        decreaseMaxListeners(this._client, 3);

        this.removeAllListeners();
        this.status = 'closed';
      }
    }
  }

  private async getRedisVersion() {
    if (this.skipVersionCheck) {
      return RedisConnection.minimumVersion;
    }

    const doc = await this._client.info();
    const redisPrefix = 'redis_version:';
    const maxMemoryPolicyPrefix = 'maxmemory_policy:';
    const lines = doc.split(/\r?\n/);
    let redisVersion;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(maxMemoryPolicyPrefix) === 0) {
        const maxMemoryPolicy = lines[i].substr(maxMemoryPolicyPrefix.length);
        if (maxMemoryPolicy !== 'noeviction') {
          console.warn(
            `IMPORTANT! Eviction policy is ${maxMemoryPolicy}. It should be "noeviction"`,
          );
        }
      }

      if (lines[i].indexOf(redisPrefix) === 0) {
        redisVersion = lines[i].substr(redisPrefix.length);
      }
    }

    return redisVersion;
  }

  get redisVersion(): string {
    return this.version;
  }
}
