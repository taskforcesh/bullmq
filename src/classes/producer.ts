import { RedisConnection } from './redis-connection';
import { QueueBase } from './queue-base';
import { ProducerOptions } from '../interfaces/producer-options';

export class Producer<DataType = any> extends QueueBase {
  constructor(
    streamName: string,
    opts?: ProducerOptions,
    Connection?: typeof RedisConnection,
  ) {
    super(
      streamName,
      {
        blockingConnection: false,
        ...opts,
      },
      Connection,
    );

    this.waitUntilReady()
      .then(client => {
        // Nothing to do here atm
      })
      .catch(err => {
        // We ignore this error to avoid warnings. The error can still
        // be received by listening to event 'error'
      });
  }

  async produce(data: DataType): Promise<void> {
    const client = await this.client;
    await client.xadd(this.name, '*', 'data', JSON.stringify(data));
  }
}
