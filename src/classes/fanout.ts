import { RedisConnection } from '@src/classes/redis-connection';
import { ConsumerOptions } from '@src/interfaces/consumer-options';
import { JobsOptions } from '@src/types';
import { Consumer } from '@src/classes/consumer';
import { Queue } from '@src/classes/queue';

export class Fanout<DataType = any> {
  private consumer: Consumer;

  constructor(
    streamName: string,
    opts?: ConsumerOptions,
    Connection?: typeof RedisConnection,
  ) {
    this.consumer = new Consumer(
      streamName,
      {
        blockingConnection: false,
        ...opts,
      },
      Connection,
    );

    this.consumer
      .waitUntilReady()
      .then(client => {
        // Nothing to do here atm
      })
      .catch(err => {
        // We ignore this error to avoid warnings. The error can still
        // be received by listening to event 'error'
      });
  }

  fanout(queues: Queue[], opts?: JobsOptions): void {
    for (const queue of queues) {
      const consumerGroup = `${this.consumer.name}:${queue.name}`;
      this.consumer.consume(consumerGroup, async (data: DataType) => {
        await queue.add('default', data, opts);
      });
    }
  }
}
