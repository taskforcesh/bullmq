import { JobsOptions } from '../interfaces';
import { ConnectionOptions } from './redis-options';

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
  connection?: ConnectionOptions;

  /**
   * Specify if the connection is shared.
   */
  sharedConnection?: boolean;

  /**
   * Prefix for all queue keys.
   */
  prefix?: string;
}

/**
 * Options for the Queue class.
 */
export interface QueueOptions extends QueueBaseOptions {
  defaultJobOptions?: JobsOptions;

  /**
   * Options for the rate limiter.
   */
  limiter?: {
    /**
     * Group key to be used by the limiter when
     * limiting by group keys.
     */
    groupKey: string;
  };

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
}

/**
 * Options for QueueEvents
 */
export interface QueueEventsOptions extends QueueBaseOptions {
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
