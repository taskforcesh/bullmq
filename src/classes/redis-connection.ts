import { EventEmitter } from 'events';
import * as IORedis from 'ioredis';
import { Cluster, Redis } from 'ioredis';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { CONNECTION_CLOSED_ERROR_MSG } from 'ioredis/built/utils';
import * as semver from 'semver';
import { load } from '../commands';
import { ConnectionOptions, RedisOptions } from '../interfaces';
import { isRedisInstance } from '../utils';

export type RedisClient = Redis | Cluster;

export class RedisConnection extends EventEmitter {
  static minimumVersion = '5.0.0';
  private _client: RedisClient;
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
      this.opts = {
        port: 6379,
        host: '127.0.0.1',
        retryStrategy: function(times: number) {
          return Math.min(Math.exp(times), 20000);
        },
        ...opts,
      };
    } else {
      this._client = <RedisClient>opts;
    }

    this.handleClientError = (err: Error): void => {
      this.emit('error', err);
    };

    this.initializing = this.init();
    this.initializing
      .then(client => client.on('error', this.handleClientError))
      .catch(err => this.emit('error', err));
  }

  /**
   * Waits for a redis client to be ready.
   * @param {Redis} redis client
   */
  static async waitUntilReady(client: RedisClient) {
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
      const handleReady = () => {
        client.removeListener('end', endHandler);
        client.removeListener('error', errorHandler);
        resolve();
      };

      const endHandler = () => {
        client.removeListener('ready', handleReady);
        client.removeListener('error', errorHandler);
        reject(new Error(CONNECTION_CLOSED_ERROR_MSG));
      };

      const errorHandler = () => {
        client.removeListener('end', endHandler);
        client.removeListener('ready', handleReady);
        reject(new Error(CONNECTION_CLOSED_ERROR_MSG));
      };

      client.once('ready', handleReady);
      client.once('end', endHandler);
      client.once('error', errorHandler);
    });
  }

  get client(): Promise<RedisClient> {
    return this.initializing;
  }

  private async init() {
    const opts = this.opts as RedisOptions;
    if (!this._client) {
      this._client = new IORedis(opts);
    }

    await RedisConnection.waitUntilReady(this._client);
    await load(this._client);

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

  async disconnect() {
    const client = await this.client;
    if (client.status !== 'end') {
      let _resolve, _reject;

      const disconnecting = new Promise((resolve, reject) => {
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

  async reconnect() {
    const client = await this.client;
    return client.connect();
  }

  async close() {
    if (!this.closing) {
      this.closing = true;
      if (!this.shared) {
        try {
          await this._client.quit();
        } catch (error) {
          if (error.message !== CONNECTION_CLOSED_ERROR_MSG) {
            throw error;
          }
        }
      } else {
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
