import { QueueBaseOptions } from '@src/interfaces';
import { EventEmitter } from 'events';
import IORedis from 'ioredis';
import { RedisConnection } from './redis-connection';

export class QueueBase extends EventEmitter {
  keys: { [index: string]: string };
  client: IORedis.Redis;

  protected connection: RedisConnection;
  closing: Promise<void>;
  private initializing: Promise<IORedis.Redis>;

  constructor(protected name: string, public opts: QueueBaseOptions = {}) {
    super();

    this.opts = {
      prefix: 'bull',
      ...opts,
    };

    this.connection = new RedisConnection(opts.connection);

    const keys: { [index: string]: string } = {};
    [
      '',
      'active',
      'wait',
      'waiting',
      'paused',
      'resumed',
      'active',
      'id',
      'delayed',
      'priority',
      'stalled-check',
      'completed',
      'failed',
      'stalled',
      'repeat',
      'limiter',
      'drained',
      'progress',
      'meta',
      'events',
      'delay',
    ].forEach(key => {
      keys[key] = this.toKey(key);
    });
    this.keys = keys;

    this.initializing = this.connection.init();
  }

  toKey(type: string) {
    return `${this.opts.prefix}:${this.name}:${type}`;
  }

  async waitUntilReady() {
    this.client = await this.initializing;
  }

  protected base64Name() {
    return Buffer.from(this.name).toString('base64');
  }

  protected clientName() {
    return this.opts.prefix + ':' + this.base64Name();
  }

  close() {
    this.closing = this.connection.close();
    return this.closing;
  }

  disconnect() {
    return this.connection.disconnect();
  }
}
