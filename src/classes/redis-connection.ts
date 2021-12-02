import { EventEmitter } from 'events';
import * as IORedis from 'ioredis';
import { Cluster, Redis } from 'ioredis';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { CONNECTION_CLOSED_ERROR_MSG } from 'ioredis/built/utils';
import * as semver from 'semver';
import { load, loadIncludes } from '../commands';
import { ConnectionOptions, RedisOptions, RedisClient } from '../interfaces';
import { isRedisInstance, isNotConnectionError } from '../utils';

import * as path from 'path';

const overrideMessage = [
  'BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null and enableReadyCheck false',
  'and will be overrided by BullMQ.',
].join(' ');

const deprecationMessage = [
  'BullMQ: DEPRECATION WARNING! Your redis options maxRetriesPerRequest must be null and enableReadyCheck false.',
  'On the next versions having this settings will throw an exception',
].join(' ');

export class RedisConnection extends EventEmitter {
  static minimumVersion = '5.0.0';
  protected _client: RedisClient;

  private initializing: Promise<RedisClient>;
  private closing: boolean;
  private version: string;
  private handleClientError: (e: Error) => void;

  constructor(
    private readonly opts?: ConnectionOptions,
    private readonly shared: boolean = false,
  ) {
    super();

    if (!isRedisInstance(opts)) {
      this.checkOptions(overrideMessage, <RedisOptions>opts);

      this.opts = {
        port: 6379,
        host: '127.0.0.1',
        retryStrategy: function (times: number) {
          return Math.min(Math.exp(times), 20000);
        },
        ...opts,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      };
    } else {
      this._client = <RedisClient>opts;
      this.checkOptions(deprecationMessage, this._client.options);
      if (
        (<RedisOptions>opts).maxRetriesPerRequest ||
        (<RedisOptions>opts).enableReadyCheck
      ) {
        console.error(deprecationMessage);
      }
    }

    this.handleClientError = (err: Error): void => {
      this.emit('error', err);
    };

    this.initializing = this.init();
    this.initializing.catch(err => this.emit('error', err));
  }

  private checkOptions(msg: string, options?: RedisOptions) {
    if (options && (options.maxRetriesPerRequest || options.enableReadyCheck)) {
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

  protected loadCommands(): Promise<void> {
    return load(this._client, path.join(__dirname, '../commands'));
  }

  protected loadIncludes(): Promise<Record<string, string>> {
    return loadIncludes(path.join(__dirname, '../commands'));
  }

  private async init() {
    const opts = this.opts as RedisOptions;
    if (!this._client) {
      this._client = new IORedis(opts);
    }

    this._client.on('error', this.handleClientError);

    await RedisConnection.waitUntilReady(this._client);
    await this.loadCommands();

    if (opts && opts.skipVersionCheck !== true && !this.closing) {
      this.version = await this.getRedisVersion();
      if (semver.lt(this.version, RedisConnection.minimumVersion)) {
        throw new Error(
          `Redis version needs to be greater than ${RedisConnection.minimumVersion} Current: ${this.version}`,
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
      }
    }
  }

  private async getRedisVersion() {
    const doc = await this._client.info();
    const prefix = 'redis_version:';
    const lines = doc.split('\r\n');

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(prefix) === 0) {
        return lines[i].substr(prefix.length);
      }
    }
  }

  get redisVersion(): string {
    return this.version;
  }
}
