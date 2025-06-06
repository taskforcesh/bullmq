import { AdvancedRepeatOptions } from './advanced-options';
import { DefaultJobOptions } from './base-job-options';
import { ConnectionOptions } from './redis-options';
import { Telemetry } from './telemetry';

export enum ClientType {
  blocking = 'blocking',
  normal = 'normal',
}

/**
 * Base Queue options
 */
export interface QueueBaseOptions {
  /**
   * Options for connecting to a Redis instance.
   */
  connection: ConnectionOptions;

  /**
   * Denotes commands should retry indefinitely.
   * @deprecated not in use anymore.
   */
  blockingConnection?: boolean;

  /**
   * Prefix for all queue keys.
   */
  prefix?: string;

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
 * Options for the Queue class.
 */
export interface QueueOptions extends QueueBaseOptions {
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
export interface RepeatBaseOptions extends QueueBaseOptions {
  settings?: AdvancedRepeatOptions;
}

/**
 * Options for QueueEvents
 */
export interface QueueEventsOptions
  extends Omit<QueueBaseOptions, 'telemetry'> {
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
export type QueueEventsProducerOptions = Omit<QueueBaseOptions, 'telemetry'>
