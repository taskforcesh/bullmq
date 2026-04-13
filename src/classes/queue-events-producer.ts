import { QueueEventsProducerOptions } from '../interfaces';
import { QueueBase } from './queue-base';
import { RedisConnection } from './redis-connection';

/**
 * The QueueEventsProducer class is used for publishing custom events.
 */
export class QueueEventsProducer extends QueueBase {
  constructor(
    name: string,
    opts: QueueEventsProducerOptions = {
      connection: {},
    },
    Connection?: typeof RedisConnection,
  ) {
    super(
      name,
      {
        blockingConnection: false,
        ...opts,
      },
      Connection,
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
    const client = await this.client;
    const key = this.keys.events;
    const { eventName, ...restArgs } = argsObj;
    const args: any[] = ['MAXLEN', '~', maxEvents, '*', 'event', eventName];

    // Always JSON-encode payload values so the consumer side can
    // symmetrically JSON-decode them. This guarantees that listeners
    // receive values with their original type (string stays string,
    // number stays number, object stays object), instead of having to
    // guess whether a field was stringified or not.
    for (const [key, value] of Object.entries(restArgs)) {
      args.push(key, JSON.stringify(value));
    }

    await client.xadd(key, ...args);
  }

  /**
   * Closes the connection and returns a promise that resolves when the connection is closed.
   */
  async close(): Promise<void> {
    if (!this.closing) {
      this.closing = this.connection.close();
    }
    await this.closing;
  }
}
