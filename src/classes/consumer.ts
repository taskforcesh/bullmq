import { RedisConnection } from '@src/classes/redis-connection';
import { QueueBase } from '@src/classes/queue-base';
import { ProducerOptions } from '@src/interfaces/producer-options';
import { v4 } from 'uuid';

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

  consume(consumerGroup: string, cb: (data: DataType) => Promise<void>): void {
    this.waitUntilReady()
      .then(async () => {
        const streamName = `${this.name}`;
        const consumerName = v4();

        const client = await this.client;
        await client.xgroup(
          'CREATE',
          streamName,
          consumerGroup,
          '0',
          'MKSTREAM',
        );

        while (!this.closing) {
          const result = (await client.xreadgroup(
            'GROUP',
            consumerGroup,
            consumerName,
            'COUNT',
            this.opts.pubsub.batchSize || 1,
            'BLOCK',
            this.opts.pubsub.blockTime || 1000,
            'STREAMS',
            streamName,
            '>',
          )) as XReadGroupResult[] | null;

          if (result && result.length > 0) {
            const [, messages] = result[0];
            for (const [id, fields] of messages) {
              const jobData: Record<string, string> = {};
              for (let i = 0; i < fields.length; i += 2) {
                const key = fields[i];
                jobData[key] = fields[i + 1];
              }
              await queue.add(
                'default',
                JSON.parse(jobData['data']),
                JSON.parse(jobData['opts']),
              );
              await client.xack(streamName, consumerGroup, id);
            }
          }
        }
      })
      .catch(error => this.emit('error', error));
  }
}
