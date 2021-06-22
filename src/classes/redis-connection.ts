import { EventEmitter } from 'events';
import * as IORedis from 'ioredis';
import { Cluster, Redis } from 'ioredis';
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

  constructor(private readonly opts?: ConnectionOptions) {
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

    this.initializing = this.init();

    this.handleClientError = (err: Error): void => {
      this.emit('error', err);
    };

    this.initializing
      .then(client => client.on('error', this.handleClientError))
      .catch(err => this.emit('error', err));
  }

  /**
   * Waits for a redis client to be ready.
   * @param {Redis} redis client
   */
  static async waitUntilReady(client: RedisClient) {
    return new Promise<void>(function(resolve, reject) {
      if (client.status === 'ready') {
        resolve();
      } else {
        const handleError = function(err: NodeJS.ErrnoException) {
          if (err['code'] !== 'ECONNREFUSED') {
            client.removeListener('ready', handleReady);
            reject(err);
          }
        };

        const handleReady = async function() {
          client.removeListener('error', handleError);
          resolve();
        };

        client.once('ready', handleReady);
        client.once('error', handleError);
      }
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
      if (this.opts != this._client) {
        await this._client.quit();
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
