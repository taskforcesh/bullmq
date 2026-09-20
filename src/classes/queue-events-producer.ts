import {
  BackendFactory,
  IQueueBackend,
  QueueEventsProducerOptions,
} from '../interfaces';
import { ConnectionOptions } from '../interfaces/redis-options';
import { QueueBase } from './queue-base';
import { RedisQueueBackend } from './redis-queue-backend';

/**
 * The QueueEventsProducer class is used for publishing custom events.
 */
export class QueueEventsProducer<
  B extends IQueueBackend = RedisQueueBackend,
  ConnectionOptionsType = ConnectionOptions,
> extends QueueBase<B, ConnectionOptionsType> {
  constructor(
    name: string,
    opts: QueueEventsProducerOptions<ConnectionOptionsType> = {
      connection: {} as ConnectionOptionsType,
    },
    backendFactory?: BackendFactory<B, ConnectionOptionsType>,
  ) {
    super(
      name,
      {
        blockingConnection: false,
        ...opts,
      },
      backendFactory,
    );

    this.opts = opts;
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
