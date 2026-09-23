import { Span } from './telemetry';
import { SpanKind } from '../enums/telemetry-attributes';
import { KeysMap } from '../classes/queue-keys';
import { QueueBaseOptions } from './queue-options';
import { IQueueBackend } from './queue-backend';

/**
 * The minimal, datastore-agnostic surface that {@link Job} and other helpers
 * need from a queue. Redis specifics (client, version, …) live behind the
 * {@link IQueueBackend} the queue owns.
 */
export interface MinimalQueue {
  readonly name: string;
  readonly qualifiedName: string;
  keys: KeysMap;
  toKey: (type: string) => string;
  opts: QueueBaseOptions;
  closing: Promise<void> | undefined;
  /**
   * The datastore backend the queue operates through.
   */
  backend: IQueueBackend;
  /**
   * Emits an event. Normally used by subclasses to emit events.
   *
   * @param event - The emitted event.
   * @param args -
   * @returns
   */
  emit(event: string | symbol, ...args: any[]): boolean;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  removeListener(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): this;
  waitUntilReady(): Promise<void>;
  /**
   * Wraps the code with telemetry and provides a span for configuration.
   *
   * @param spanKind - kind of the span: Producer, Consumer, Internal
   * @param operation - operation name (such as add, process, etc)
   * @param destination - destination name (normally the queue name)
   * @param callback - code to wrap with telemetry
   * @param srcPropagationMetadata -
   * @returns
   */
  trace<T>(
    spanKind: SpanKind,
    operation: string,
    destination: string,
    callback: (span?: Span, dstPropagationMetadata?: string) => Promise<T> | T,
    srcPropagationMetadata?: string,
  ): Promise<T | Promise<T>>;
}
