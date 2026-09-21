import {
  BackendFactory,
  IQueueBackend,
  QueueEventsProducerOptions,
} from '../interfaces';
import { ConnectionOptions } from '../interfaces/redis-options';
import { QueueBase } from './queue-base';
import { RedisQueueBackend } from './redis-queue-backend';
import type { DefaultQueueOptions } from '../types/default-queue-options';

/**
 * The QueueEventsProducer class is used for publishing custom events.
 */
export class QueueEventsProducer<
  B extends IQueueBackend = RedisQueueBackend,
  ConnectionOptionsType = ConnectionOptions,
> extends QueueBase<B, ConnectionOptionsType> {
  constructor(
    name: string,
    opts: QueueEventsProducerOptions<NoInfer<ConnectionOptionsType>>,
    backendFactory?: BackendFactory<B, ConnectionOptionsType>,
  );
  constructor(
    name: string,
    ...args: DefaultQueueOptions<B, ConnectionOptionsType, RedisQueueBackend>
  );
  constructor(
    name: string,
    opts?: QueueEventsProducerOptions<ConnectionOptionsType>,
    backendFactory?: BackendFactory<B, ConnectionOptionsType>,
  ) {
    super(name, opts && { blockingConnection: false, ...opts }, backendFactory);
    if (opts) {
      this.opts = opts;
    }
  }

  /**
   * Publish custom event to be processed in QueueEvents.
   * @param argsObj - Event payload
   * @param maxEvents - Max quantity of events to be saved
   */
  async publishEvent<T extends { eventName: string }>(
    argsObj: T,
    maxEvents = 1000,
  ): Promise<void> {
    const { eventName, ...restArgs } = argsObj;
    const fields: Record<string, string | number> = {
      event: eventName,
      ...restArgs,
    };

    await this.backend.publishEvent(fields, maxEvents);
  }

  /**
   * Closes the connection and returns a promise that resolves when the connection is closed.
   */
  async close(): Promise<void> {
    if (!this.closing) {
      this.closing = this.backend.close();
    }
    await this.closing;
  }
}
