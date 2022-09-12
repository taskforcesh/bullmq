import { EventEmitter } from 'events';
import { default as IORedis } from 'ioredis';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { CONNECTION_CLOSED_ERROR_MSG } from 'ioredis/built/utils';
import { scriptLoader, ScriptMetadata } from '../commands';
import { ConnectionOptions, RedisOptions, RedisClient } from '../interfaces';
import {
  isNotConnectionError,
  isRedisCluster,
  isRedisInstance,
  isRedisVersionLowerThan,
} from '../utils';

import * as path from 'path';

const overrideMessage = [
  'BullMQ: WARNING! Your redis options maxRetriesPerRequest must be null',
  'and will be overridden by BullMQ.',
].join(' ');

const deprecationMessage = [
  'BullMQ: DEPRECATION WARNING! Your redis options maxRetriesPerRequest must be null.',
  'On the next versions having this settings will throw an exception',
].join(' ');

const upstashMessage = 'BullMQ: Upstash is not compatible with BullMQ.';

export class RedisConnection extends EventEmitter {
  static minimumVersion = '5.0.0';
  protected _client: RedisClient;

  private readonly opts: RedisOptions;
  private initializing: Promise<RedisClient>;
  private closing: boolean;
  private version: string;
  private handleClientError: (e: Error) => void;
  private handleClientClose: () => void;

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
          return Math.min(Math.exp(times), 20000);
        },
        ...opts,
      };

      if (this.blocking) {
        this.opts.maxRetriesPerRequest = null;
      }

      this.checkUpstashHost(this.opts.host);
    } else {
      this._client = opts;

      if (isRedisCluster(this._client)) {
        this.opts = this._client.options.redisOptions;
        const hosts = (<any>this._client).startupNodes.map(
          (node: { host: string }) => node.host,
        );
        this.checkUpstashHost(hosts);
      } else {
        this.opts = this._client.options;

        this.checkUpstashHost(this.opts.host);
      }

      this.checkBlockingOptions(deprecationMessage, this.opts);
    }

    this.handleClientError = (err: Error): void => {
      this.emit('error', err);
    };

    this.handleClientClose = (): void => {
      this.emit('close');
    };

    this.initializing = this.init();
    this.initializing.catch(err => this.emit('error', err));
  }

  private checkBlockingOptions(msg: string, options?: RedisOptions) {
    if (this.blocking && options && options.maxRetriesPerRequest) {
      console.error(msg);
    }
  }

  private checkUpstashHost(host: string[] | string | undefined) {
    const includesUpstash = Array.isArray(host)
      ? host.some(node => node.endsWith('upstash.io'))
      : host?.endsWith('upstash.io');
    if (includesUpstash) {
      throw new Error(upstashMessage);
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

  protected loadCommands(cache?: Map<string, ScriptMetadata>): Promise<void> {
    return (
      (<any>this._client)['bullmq:loadingCommands'] ||
      ((<any>this._client)['bullmq:loadingCommands'] = scriptLoader.load(
        this._client,
        path.join(__dirname, '../commands'),
        cache ?? new Map<string, ScriptMetadata>(),
      ))
    );
  }

  private async init() {
    if (!this._client) {
      this._client = new IORedis(this.opts);
    }

    this._client.on('error', this.handleClientError);
    // ioredis treats connection errors as a different event ('close')
    this._client.on('close', this.handleClientClose);

    await RedisConnection.waitUntilReady(this._client);
    await this.loadCommands();

    if (this.opts && this.opts.skipVersionCheck !== true && !this.closing) {
      this.version = await this.getRedisVersion();
      if (
        isRedisVersionLowerThan(this.version, RedisConnection.minimumVersion)
      ) {
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
        this._client.off('close', this.handleClientClose);
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
