import { EventEmitter } from 'events';
import * as IORedis from 'ioredis';
import * as semver from 'semver';
import { load } from '../commands';
import { ConnectionOptions, RedisOptions } from '../interfaces';
import { isRedisInstance } from '../utils';

export class RedisConnection extends EventEmitter {
  static minimumVersion = '5.0.0';
  private _client: IORedis.Redis;
  private initializing: Promise<IORedis.Redis>;
  private closing: boolean;

  constructor(private opts?: ConnectionOptions) {
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
      this._client = <IORedis.Redis>opts;
    }

    this.initializing = this.init();

    this.initializing
      .then(client => client.on('error', this.emit.bind(this, 'error')))
      .catch(err => this.emit('error', err));
  }

  /**
   * Waits for a redis client to be ready.
   * @param {Redis} redis client
   */
  static async waitUntilReady(client: IORedis.Redis) {
    return new Promise(function(resolve, reject) {
      if (client.status === 'ready') {
        resolve();
      } else {
        async function handleReady() {
          client.removeListener('error', handleError);
          await load(client);
          resolve();
        }

        function handleError(err: Error) {
          client.removeListener('ready', handleReady);
          reject(err);
        }

        client.once('ready', handleReady);
        client.once('error', handleError);
      }
    });
  }

  get client(): Promise<IORedis.Redis> {
    return this.initializing;
  }

  private async init() {
    const opts = this.opts as RedisOptions;
    if (!this._client) {
      this._client = new IORedis(opts);
    }

    await RedisConnection.waitUntilReady(this._client);

    if (opts && opts.skipVersionCheck !== true && !this.closing) {
      const version = await this.getRedisVersion();
      if (semver.lt(version, RedisConnection.minimumVersion)) {
        throw new Error(
          `Redis version needs to be greater than ${RedisConnection.minimumVersion} Current: ${version}`,
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
}
