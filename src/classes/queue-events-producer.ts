import { BackendFactory, QueueEventsProducerOptions } from '../interfaces';
import { QueueBase } from './queue-base';

/**
 * The QueueEventsProducer class is used for publishing custom events.
 */
export class QueueEventsProducer extends QueueBase {
  constructor(
    name: string,
    opts: QueueEventsProducerOptions = {
      connection: {},
    },
    backendFactory?: BackendFactory,
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
