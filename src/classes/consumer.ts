import { RedisConnection } from '@src/classes/redis-connection';
import { QueueBase } from '@src/classes/queue-base';
import { ProducerOptions } from '@src/interfaces/producer-options';

export class Consumer<DataType = any> extends QueueBase {
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

  async consume(cb: (data: DataType) => Promise<void>): Promise<void> {
    const client = await this.client;
    const stream = client.xread('BLOCK', 0, 'STREAMS', this.name, '>');
    stream.on('data', async data => {
      const [key, [id, data]] = data;
      await cb(JSON.parse(data));
      await client.xack(this.name, this.name, id);
    });
  }
}
