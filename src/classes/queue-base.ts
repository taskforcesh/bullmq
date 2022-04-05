import { EventEmitter } from 'events';
import { QueueBaseOptions, RedisClient } from '../interfaces';
import { RedisConnection } from './redis-connection';
import { KeysMap, QueueKeys } from './queue-keys';

export class QueueBase extends EventEmitter {
  toKey: (type: string) => string;
  keys: KeysMap;
  closing: Promise<void>;

  protected connection: RedisConnection;

  constructor(
    public readonly name: string,
    public opts: QueueBaseOptions = {},
    Connection: typeof RedisConnection = RedisConnection,
  ) {
    super();

    this.opts = {
      prefix: 'bull',
      ...opts,
    };

    if (!opts.connection) {
      console.warn(
        [
          'BullMQ: DEPRECATION WARNING! Optional instantiation of Queue, Worker, QueueScheduler and QueueEvents',
          'without providing explicitly a connection or connection options is deprecated. This behaviour will',
          'be removed in the next major release',
        ].join(' '),
      );
    }

    this.connection = new Connection(opts.connection, opts.sharedConnection);
    this.connection.on('error', this.emit.bind(this, 'error'));

    const queueKeys = new QueueKeys(opts.prefix);
    this.keys = queueKeys.getKeys(name);
    this.toKey = (type: string) => queueKeys.toKey(name, type);
  }

  get client(): Promise<RedisClient> {
    return this.connection.client;
  }

  get redisVersion(): string {
    return this.connection.redisVersion;
  }

  emit(event: string | symbol, ...args: any[]): boolean {
    try {
      return super.emit(event, ...args);
    } catch (err) {
      try {
        return super.emit('error', err);
      } catch (err) {
        // We give up if the error event also throws an exception.
        console.error(err);
      }
    }
  }

  waitUntilReady(): Promise<RedisClient> {
    return this.client;
  }

  protected base64Name(): string {
    return Buffer.from(this.name).toString('base64');
  }

  protected clientName(suffix = ''): string {
    const queueNameBase64 = this.base64Name();
    return `${this.opts.prefix}:${queueNameBase64}${suffix}`;
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closing = this.connection.close();
    }
    return this.closing;
  }

  disconnect(): Promise<void> {
    return this.connection.disconnect();
  }
}
