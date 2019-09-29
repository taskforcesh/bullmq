import { EventEmitter } from 'events';
import IORedis from 'ioredis';
import { QueueBaseOptions } from '../interfaces';
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

    this.waitUntilReady()
      .then(client => client.on('error', this.emit.bind(this)))
      .catch(err => this.emit('error'));
  }

  toKey(type: string) {
    return `${this.opts.prefix}:${this.name}:${type}`;
  }

  async waitUntilReady() {
    if (!this.initializing) {
      this.initializing = this.connection.init();
    }

    return (this.client = await this.initializing);
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
