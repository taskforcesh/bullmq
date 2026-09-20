import { AdvancedRepeatOptions } from './advanced-options';
import { DefaultJobOptions } from './base-job-options';
import { ConnectionOptions } from './redis-options';
import { Telemetry } from './telemetry';

export enum ClientType {
  blocking = 'blocking',
  normal = 'normal',
}

/**
 * Base Queue options.
 *
 * @typeParam ConnectionOptionsType - The shape of the `connection` option.
 * Defaults to the Redis connection union ({@link ConnectionOptions}). Backends
 * other than Redis (e.g. the PostgreSQL adapter) provide their own connection
 * type and their {@link BackendFactory} is typed accordingly, so passing that
 * factory into a queue class narrows `connection` to the matching type without
 * widening it for everyone else.
 */
export interface QueueBaseOptions<ConnectionOptionsType = ConnectionOptions> {
  /**
   * Options for connecting to the backend datastore (Redis by default).
   */
  connection: ConnectionOptionsType;

  /**
   * Denotes commands should retry indefinitely.
   * @deprecated not in use anymore.
   */
  blockingConnection?: boolean;

  /**
   * Avoid version validation to be greater or equal than v5.0.0.
   * @defaultValue false
   */
  skipVersionCheck?: boolean;

  /**
   * Telemetry client
   */
  telemetry?: Telemetry;

  /**
   * Skip waiting for connection ready.
   *
   * In some instances if you want the queue to fail fast if the connection is
   * not ready you can set this to true. This could be useful for testing and when
   * adding jobs via HTTP endpoints for example.
   *
   */
  skipWaitingForReady?: boolean;
}

/**
 * Options honored only by the Redis backend. The key `prefix` namespaces all of
 * a queue's Redis keys, so BullMQ data can coexist with other keys in a shared
 * keyspace. It is intentionally NOT part of {@link QueueBaseOptions}, because it
 * is a Redis-specific concept: other backends namespace differently (e.g. the
 * PostgreSQL backend uses a schema) and ignore it.
 */
export interface KeyPrefixOptions {
  /**
   * Prefix for all queue keys (Redis backend only). Defaults to `bull`.
   */
  prefix?: string;
}

/**
 * @deprecated Use KeyPrefixOptions instead.
 */
export type RedisKeyPrefixOptions = KeyPrefixOptions;

/**
 * Options for the Queue class.
 */
export interface QueueOptions<ConnectionOptionsType = ConnectionOptions>
  extends QueueBaseOptions<ConnectionOptionsType>, KeyPrefixOptions {
  defaultJobOptions?: DefaultJobOptions;

  /**
   * Options for the streams used internally in BullMQ.
   */
  streams?: {
    /**
     * Options for the events stream.
     */
    events: {
      /**
       * Max approximated length for streams. Default is 10 000 events.
       */
      maxLen: number;
    };
  };

  /**
   * Skip Meta update.
   *
   * If true, the queue will not update the metadata of the queue.
   * Useful for read-only systems that do should not update the metadata.
   *
   * @defaultValue false
   */
  skipMetasUpdate?: boolean;

  /**
   * Advanced options for the repeatable jobs.
   */
  settings?: AdvancedRepeatOptions;
}

/**
 * Options for the Repeat class.
 */
export interface RepeatBaseOptions<ConnectionOptionsType = ConnectionOptions>
  extends QueueBaseOptions<ConnectionOptionsType>, KeyPrefixOptions {
  settings?: AdvancedRepeatOptions;
}

/**
 * Options for QueueEvents
 */
export interface QueueEventsOptions<ConnectionOptionsType = ConnectionOptions>
  extends
    Omit<QueueBaseOptions<ConnectionOptionsType>, 'telemetry'>,
    KeyPrefixOptions {
  /**
   * Condition to start listening to events at instance creation.
   */
  autorun?: boolean;
  /**
   * Last event Id. If provided it is possible to continue
   * consuming events from a known Id instead of from the last
   * produced event.
   */
  lastEventId?: string;

  /**
   * Timeout for the blocking XREAD call to the events stream.
   */
  blockingTimeout?: number;
}

/**
 * Options for QueueEventsProducer
 */
export type QueueEventsProducerOptions<
  ConnectionOptionsType = ConnectionOptions,
> = Omit<QueueBaseOptions<ConnectionOptionsType>, 'telemetry'> &
  KeyPrefixOptions;

/**
 * Options for the FlowProducer class.
 */
export interface FlowProducerOptions<ConnectionOptionsType = ConnectionOptions>
  extends QueueBaseOptions<ConnectionOptionsType>, KeyPrefixOptions {}
