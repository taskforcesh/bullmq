import { EventEmitter } from 'events';
import { QueueBaseOptions, RedisClient } from '../interfaces';
import { MinimalQueue } from '../types';
import {
  delay,
  DELAY_TIME_5,
  isNotConnectionError,
  isRedisInstance,
} from '../utils';
import { RedisConnection } from './redis-connection';
import { Job } from './job';
import { KeysMap, QueueKeys } from './queue-keys';
import { Scripts } from './scripts';

/**
 * @class QueueBase
 * @extends EventEmitter
 *
 * @description Base class for all classes that need to interact with queues.
 * This class is normally not used directly, but extended by the other classes.
 *
 */
export class QueueBase extends EventEmitter implements MinimalQueue {
  toKey: (type: string) => string;
  keys: KeysMap;
  closing: Promise<void> | undefined;

  protected closed: boolean = false;
  protected hasBlockingConnection: boolean = false;
  protected scripts: Scripts;
  protected connection: RedisConnection;
  public readonly qualifiedName: string;

  /**
   *
   * @param name - The name of the queue.
   * @param opts - Options for the queue.
   * @param Connection - An optional "Connection" class used to instantiate a Connection. This is useful for
   * testing with mockups and/or extending the Connection class and passing an alternate implementation.
   */
  constructor(
    public readonly name: string,
    public opts: QueueBaseOptions = { connection: {} },
    Connection: typeof RedisConnection = RedisConnection,
    hasBlockingConnection = false,
  ) {
    super();

    this.hasBlockingConnection = hasBlockingConnection;
    this.opts = {
      prefix: 'bull',
      ...opts,
    };

    if (!name) {
      throw new Error('Queue name must be provided');
    }

    if (name.includes(':')) {
      throw new Error('Queue name cannot contain :');
    }

    this.connection = new Connection(
      opts.connection,
      isRedisInstance(opts.connection),
      hasBlockingConnection,
      opts.skipVersionCheck,
    );

    this.connection.on('error', (error: Error) => this.emit('error', error));
    this.connection.on('close', () => {
      if (!this.closing) {
        this.emit('ioredis:close');
      }
    });

    const queueKeys = new QueueKeys(opts.prefix);
    this.qualifiedName = queueKeys.getQueueQualifiedName(name);
    this.keys = queueKeys.getKeys(name);
    this.toKey = (type: string) => queueKeys.toKey(name, type);
    this.setScripts();
  }

  /**
   * Returns a promise that resolves to a redis client. Normally used only by subclasses.
   */
  get client(): Promise<RedisClient> {
    return this.connection.client;
  }

  protected setScripts() {
    this.scripts = new Scripts(this);
  }

  /**
   * Returns the version of the Redis instance the client is connected to,
   */
  get redisVersion(): string {
    return this.connection.redisVersion;
  }

  /**
   * Helper to easily extend Job class calls.
   */
  protected get Job(): typeof Job {
    return Job;
  }

  /**
   * Emits an event. Normally used by subclasses to emit events.
   *
   * @param event - The emitted event.
   * @param args -
   * @returns
   */
  emit(event: string | symbol, ...args: any[]): boolean {
    try {
      return super.emit(event, ...args);
    } catch (err) {
      try {
        return super.emit('error', err);
      } catch (err) {
        // We give up if the error event also throws an exception.
        console.error(err);
        return false;
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

  /**
   *
   * Closes the connection and returns a promise that resolves when the connection is closed.
   */
  async close(): Promise<void> {
    if (!this.closing) {
      this.closing = this.connection.close();
    }
    await this.closing;
    this.closed = true;
  }

  /**
   *
   * Force disconnects a connection.
   */
  disconnect(): Promise<void> {
    return this.connection.disconnect();
  }

  protected async checkConnectionError<T>(
    fn: () => Promise<T>,
    delayInMs = DELAY_TIME_5,
  ): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      if (isNotConnectionError(error as Error)) {
        this.emit('error', <Error>error);
      }

      if (!this.closing && delayInMs) {
        await delay(delayInMs);
      } else {
        return;
      }
    }
  }
}
