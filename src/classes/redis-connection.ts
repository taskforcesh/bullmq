import { EventEmitter } from 'events';
import { default as IORedis } from 'ioredis';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { CONNECTION_CLOSED_ERROR_MSG } from 'ioredis/built/utils';
import { ConnectionOptions, RedisOptions, RedisClient } from '../interfaces';
import {
  isNotConnectionError,
  isRedisCluster,
  isRedisInstance,
  isRedisVersionLowerThan,
} from '../utils';
import * as scripts from '../scripts';

const overrideMessage = [
  'BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null',
  'and will be overridden by BullMQ.',
].join(' ');

const deprecationMessage = [
  'BullMQ: DEPRECATION WARNING! Your redis options maxRetriesPerRequest must be null.',
  'On the next versions having this settings will throw an exception',
].join(' ');

export interface RawCommand {
  content: string;
  name: string;
  keys: number;
}

export class RedisConnection extends EventEmitter {
  static minimumVersion = '5.0.0';
  static recommendedMinimumVersion = '6.2.0';

  closing: boolean;

  protected _client: RedisClient;

  private readonly opts: RedisOptions;
  private initializing: Promise<RedisClient>;

  private version: string;
  private handleClientError: (e: Error) => void;
  private handleClientClose: () => void;
  private handleClientReady: () => void;

  constructor(
    opts?: ConnectionOptions,
    private readonly shared: boolean = false,
    private readonly blocking = true,
  ) {
    super();

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

      if (this.blocking) {
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

      this.checkBlockingOptions(deprecationMessage, this.opts);
    }

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

  private checkBlockingOptions(msg: string, options?: RedisOptions) {
    if (this.blocking && options && options.maxRetriesPerRequest) {
      console.error(msg);
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

    return new Promise<void>((resolve, reject) => {
      let lastError: Error;
      const errorHandler = (err: Error) => {
        lastError = err;
      };

      const handleReady = () => {
        client.removeListener('end', endHandler);
        client.removeListener('error', errorHandler);
        resolve();
      };

      const endHandler = () => {
        client.removeListener('ready', handleReady);
        client.removeListener('error', errorHandler);
        reject(lastError || new Error(CONNECTION_CLOSED_ERROR_MSG));
      };

      client.once('ready', handleReady);
      client.on('end', endHandler);
      client.once('error', errorHandler);
    });
  }

  get client(): Promise<RedisClient> {
    return this.initializing;
  }

  protected loadCommands(providedScripts?: Record<string, RawCommand>): void {
    const finalScripts =
      providedScripts || (scripts as Record<string, RawCommand>);
    for (const property in finalScripts as Record<string, RawCommand>) {
      // Only define the command if not already defined
      if (!(<any>this._client)[finalScripts[property].name]) {
        (<any>this._client).defineCommand(finalScripts[property].name, {
          numberOfKeys: finalScripts[property].keys,
          lua: finalScripts[property].content,
        });
      }
    }
  }

  private async init() {
    if (!this._client) {
      this._client = new IORedis(this.opts);
    }

    this._client.on('error', this.handleClientError);
    // ioredis treats connection errors as a different event ('close')
    this._client.on('close', this.handleClientClose);

    this._client.on('ready', this.handleClientReady);

    await RedisConnection.waitUntilReady(this._client);
    this.loadCommands();

    this.version = await this.getRedisVersion();
    if (this.opts && this.opts.skipVersionCheck !== true && !this.closing) {
      if (
        isRedisVersionLowerThan(this.version, RedisConnection.minimumVersion)
      ) {
        throw new Error(
          `Redis version needs to be greater than ${RedisConnection.minimumVersion} Current: ${this.version}`,
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
    return this._client;
  }

  async disconnect(): Promise<void> {
    const client = await this.client;
    if (client.status !== 'end') {
      let _resolve, _reject;

      const disconnecting = new Promise<void>((resolve, reject) => {
        client.once('end', resolve);
        client.once('error', reject);
        _resolve = resolve;
        _reject = reject;
      });

      client.disconnect();

      try {
        await disconnecting;
      } finally {
        client.removeListener('end', _resolve);
        client.removeListener('error', _reject);
      }
    }
  }

  async reconnect(): Promise<void> {
    const client = await this.client;
    return client.connect();
  }

  async close(): Promise<void> {
    if (!this.closing) {
      this.closing = true;
      try {
        await this.initializing;
        if (!this.shared) {
          await this._client.quit();
        }
      } catch (error) {
        if (isNotConnectionError(error as Error)) {
          throw error;
        }
      } finally {
        this._client.off('error', this.handleClientError);
        this._client.off('close', this.handleClientClose);
        this._client.off('ready', this.handleClientReady);
      }
    }
  }

  private async getRedisVersion() {
    const doc = await this._client.info();
    const redisPrefix = 'redis_version:';
    const maxMemoryPolicyPrefix = 'maxmemory_policy:';
    const lines = doc.split('\r\n');
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
