import { EventEmitter } from 'events';
import {
  BackendFactory,
  IQueueBackend,
  MinimalQueue,
  QueueBaseOptions,
  Span,
} from '../interfaces';

import { delay, DELAY_TIME_5, isNotConnectionError, trace } from '../utils';
import { createRedisBackend } from '../utils/create-backend';
import { Job } from './job';
import { KeysMap, QueueKeys } from './queue-keys';
import { SpanKind } from '../enums';

/**
 * Base class for all classes that need to interact with queues.
 * This class is normally not used directly, but extended by the other classes.
 *
 */
export class QueueBase<B extends IQueueBackend = IQueueBackend>
  extends EventEmitter
  implements MinimalQueue
{
  toKey: (type: string) => string;
  keys: KeysMap;
  closing: Promise<void> | undefined;

  protected closed = false;
  protected hasBlockingConnection = false;
  backend: B;
  protected readonly backendFactory: BackendFactory<B>;
  public readonly qualifiedName: string;

  /**
   *
   * @param name - The name of the queue.
   * @param opts - Options for the queue.
   * @param backendFactory - Factory used to build the {@link IQueueBackend}.
   * Defaults to the Redis backend; inject a different factory to use another
   * datastore or a test mock.
   */
  constructor(
    public readonly name: string,
    public opts: QueueBaseOptions = { connection: {} },
    backendFactory: BackendFactory<B> = createRedisBackend as unknown as BackendFactory<B>,
    hasBlockingConnection = false,
  ) {
    super();

    this.backendFactory = backendFactory;
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

    const queueKeys = new QueueKeys(opts.prefix);
    this.qualifiedName = queueKeys.getQueueQualifiedName(name);
    this.keys = queueKeys.getKeys(name);
    this.toKey = (type: string) => queueKeys.toKey(name, type);
    this.createBackend();

    this.backend.on('error', (error: Error) => this.emit('error', error));
    this.backend.on('close', () => {
      if (!this.closing) {
        this.emit('ioredis:close');
      }
    });
  }

  /**
   * Resolves once the underlying backend (and its connection) is ready.
   */
  waitUntilReady(): Promise<void> {
    return this.backend.waitUntilReady();
  }

  /**
   * Returns the datastore backend that powers this instance.
   *
   * The backend owns its connection(s) and exposes every datastore-agnostic
   * operation through {@link IQueueBackend}. Datastore-specific escape hatches
   * (e.g. the raw Redis client) live on the concrete backend implementation,
   * and are exposed here when the class is parameterized on that concrete
   * backend type (the default for the built-in, Redis-backed classes).
   */
  getBackend(): B {
    return this.backend;
  }

  protected createBackend(): void {
    this.backend = this.backendFactory(this.name, this.opts, {
      blocking: this.hasBlockingConnection,
    });
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
   * @param args - The arguments to pass to the event listeners.
   * @returns True if the event had listeners, false otherwise.
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
      this.closing = this.backend.close();
    }
    await this.closing;
    this.closed = true;
  }

  /**
   *
   * Force disconnects a connection.
   */
  disconnect(): Promise<void> {
    return this.backend.disconnect();
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

  /**
   * Wraps the code with telemetry and provides a span for configuration.
   *
   * @param spanKind - kind of the span: Producer, Consumer, Internal
   * @param operation - operation name (such as add, process, etc)
   * @param destination - destination name (normally the queue name)
   * @param callback - code to wrap with telemetry
   * @param srcPropagationMetadata - The source propagation metadata for telemetry context.
   * @returns The result of the callback function.
   */
  trace<T>(
    spanKind: SpanKind,
    operation: string,
    destination: string,
    callback: (span?: Span, dstPropagationMetadata?: string) => Promise<T> | T,
    srcPropagationMetadata?: string,
  ) {
    return trace<Promise<T> | T>(
      this.opts.telemetry,
      spanKind,
      this.name,
      operation,
      destination,
      callback,
      srcPropagationMetadata,
    );
  }
}
