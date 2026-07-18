import { RedisClient } from './connection';
import { Span } from './telemetry';
import { SpanKind } from '../enums/telemetry-attributes';
import { ScriptQueueContext } from './script-queue-context';
import type { Scripts } from '../classes/scripts';

export interface MinimalQueue extends ScriptQueueContext {
  readonly name: string;
  readonly qualifiedName: string;
  /**
   * The long-lived Scripts instance shared by the queue. Jobs reuse this
   * instance instead of allocating their own, since it is bound to the same
   * queue keys and connection. Optional only so that custom queue-like
   * implementations remain valid; the built-in Queue, Worker and FlowProducer
   * always provide one so no redundant Scripts is created per job.
   */
  readonly scripts?: Scripts;
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
  waitUntilReady(): Promise<RedisClient>;
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
