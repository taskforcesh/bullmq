import { EventEmitter } from 'events';
import { QueueBaseOptions } from '../interfaces';
import { RedisClient, RedisConnection } from './redis-connection';
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

    if (Object.keys(opts).length === 1) {
      console.warn(`DEPRECATION WARNING: Currently it is possible to instantiate Queue, Worker, QueueScheduler, etc
      without providing explicitly a connection or connection options. This behaviour will be removed in major
      release`);
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

  protected clientName(): string {
    return this.opts.prefix + ':' + this.base64Name();
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
