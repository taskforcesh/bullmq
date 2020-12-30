import { EventEmitter } from 'events';
import { QueueBaseOptions } from '../interfaces';
import { RedisConnection } from './redis-connection';
import * as IORedis from 'ioredis';

export class QueueBase extends EventEmitter {
  keys: { [index: string]: string };
  closing: Promise<void>;

  protected connection: RedisConnection;

  constructor(
    public readonly name: string,
    public opts: QueueBaseOptions = {},
  ) {
    super();

    this.opts = {
      prefix: 'bull',
      ...opts,
    };

    this.connection = new RedisConnection(opts.connection);
    this.connection.on('error', this.emit.bind(this, 'error'));

    const keys: { [index: string]: string } = {};
    [
      '',
      'active',
      'wait',
      'waiting',
      'paused',
      'resumed',
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
  }

  toKey(type: string) {
    return `${this.opts.prefix}:${this.name}:${type}`;
  }

  get client(): Promise<IORedis.Redis> {
    return this.connection.client;
  }

  async waitUntilReady() {
    return this.client;
  }

  protected base64Name() {
    return Buffer.from(this.name).toString('base64');
  }

  protected clientName() {
    return this.opts.prefix + ':' + this.base64Name();
  }

  close() {
    if (!this.closing) {
      this.closing = this.connection.close();
    }
    return this.closing;
  }

  disconnect() {
    return this.connection.disconnect();
  }
}
