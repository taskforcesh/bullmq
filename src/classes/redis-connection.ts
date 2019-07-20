import { RedisOpts, ConnectionOptions } from '@src/interfaces';
import IORedis from 'ioredis';
import * as semver from 'semver';
import { load } from '@src/commands';

export class RedisConnection {
  static minimumVersion = '5.0.0';
  client: IORedis.Redis;

  constructor(private opts?: ConnectionOptions) {
    if (!(opts instanceof IORedis)) {
      this.opts = Object.assign(
        {
          port: 6379,
          host: '127.0.0.1',
          retryStrategy: function(times: number) {
            return Math.min(Math.exp(times), 20000);
          },
        },
        opts,
      );
    } else {
      this.client = opts;
    }
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

  async init() {
    if (!this.client) {
      this.client = new IORedis(<RedisOpts>this.opts);
    }

    await RedisConnection.waitUntilReady(this.client);

    this.client.on('error', (err: Error) => {
      console.error(err);
    });

    if ((<RedisOpts>this.opts).skipVersionCheck !== true) {
      const version = await this.getRedisVersion();
      if (semver.lt(version, RedisConnection.minimumVersion)) {
        throw new Error(
          `Redis version needs to be greater than ${RedisConnection.minimumVersion} Current: ${version}`,
        );
      }
    }
    return this.client;
  }

  async close() {}

  private async getRedisVersion() {
    const doc = await this.client.info();
    const prefix = 'redis_version:';
    const lines = doc.split('\r\n');

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(prefix) === 0) {
        return lines[i].substr(prefix.length);
      }
    }
  }
}
