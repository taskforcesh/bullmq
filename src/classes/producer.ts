import { RedisConnection } from '@src/classes/redis-connection';
import { QueueBase } from '@src/classes/queue-base';
import { ProducerOptions } from '@src/interfaces/producer-options';

export class Producer<DataType = any> extends QueueBase {
  constructor(
    name: string,
    opts?: ProducerOptions,
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

    this.waitUntilReady()
      .then(client => {
        // Nothing to do here atm
      })
      .catch(err => {
        // We ignore this error to avoid warnings. The error can still
        // be received by listening to event 'error'
      });
  }

  async producer(data: DataType): Promise<void> {
    const client = await this.client;
    await client.xadd(this.name, '*', 'data', JSON.stringify(data));
  }
}
