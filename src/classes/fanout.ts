import { RedisConnection } from './redis-connection';
import { ConsumerOptions } from '../interfaces/consumer-options';
import { JobsOptions } from '../types';
import { Consumer } from './consumer';
import { Queue } from './queue';

export class Fanout<DataType = any> {
  private consumer: Consumer;
  private closed: Promise<void>;

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

    this.closed = new Promise<void>((resolve, reject) => {
      this.consumer.on('close', () => {
        resolve();
      });
    });
  }

  async fanout(
    queues: Queue[],
    opts?: (data: DataType) => JobsOptions,
  ): Promise<void> {
    for (const queue of queues) {
      const consumerGroup = `${this.consumer.name}:${queue.name}`;
      this.consumer.consume(consumerGroup, async (data: DataType) => {
        const renderedOpts = opts ? opts(data) : undefined;
        await queue.add('default', data, renderedOpts);
      });
    }
    await this.closed;
  }

  async close(): Promise<void> {
    await this.consumer.close();
  }
}
