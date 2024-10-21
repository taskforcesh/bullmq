import { RedisConnection } from './redis-connection';
import { QueueBase } from './queue-base';
import { v4 } from 'uuid';
import { ConsumerOptions } from '../interfaces/consumer-options';
import { RedisClient } from '../interfaces';
import { delay } from '../utils';

type XReadGroupResult = [string, [string, string[]][]];

export class Consumer<DataType = any> extends QueueBase {
  protected consumerOpts: ConsumerOptions;

  constructor(
    streamName: string,
    opts?: ConsumerOptions,
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

    this.consumerOpts = opts || { connection: {} };

    this.waitUntilReady()
      .then(client => {
        this.trimStream();
      })
      .catch(err => {
        // We ignore this error to avoid warnings. The error can still
        // be received by listening to event 'error'
      });
  }

  consume(consumerGroup: string, cb: (data: DataType) => Promise<void>): void {
    this.waitUntilReady()
      .then(async () => {
        const streamName = this.name;
        const consumerName = v4();

        const client = await this.client;

        try {
          // Create the consumer group if it doesn't already exist
          await client.xgroup(
            'CREATE',
            streamName,
            consumerGroup,
            '0',
            'MKSTREAM',
          );
        } catch (error) {
          if (!(error as Error).message.includes('BUSYGROUP')) {
            // If the group already exists, ignore the error
            throw error;
          }
        }

        while (!this.closing) {
          try {
            // First, read pending messages (PEL)
            const pendingResult = (await client.xreadgroup(
              'GROUP',
              consumerGroup,
              consumerName,
              'COUNT',
              this.consumerOpts.batchSize || 1,
              'BLOCK',
              this.consumerOpts.blockTimeMs || 1000,
              'STREAMS',
              streamName,
              '0', // Read all pending messages
            )) as XReadGroupResult[] | null;

            if (pendingResult && pendingResult.length > 0) {
              await this.processMessages(
                client,
                streamName,
                consumerGroup,
                pendingResult,
                cb,
              );
              continue; // Continue to the next loop to check for more pending messages
            }

            // Then read new messages if no pending messages are left
            const newResult = (await client.xreadgroup(
              'GROUP',
              consumerGroup,
              consumerName,
              'COUNT',
              this.consumerOpts.batchSize || 1,
              'BLOCK',
              this.consumerOpts.blockTimeMs || 1000,
              'STREAMS',
              streamName,
              '>', // Read new messages
            )) as XReadGroupResult[] | null;

            if (newResult && newResult.length > 0) {
              await this.processMessages(
                client,
                streamName,
                consumerGroup,
                newResult,
                cb,
              );
            }
          } catch (e) {
            this.emit('error', e);
          }
        }
      })
      .catch(error => this.emit('error', error));
  }

  private async processMessages(
    client: RedisClient,
    streamName: string,
    consumerGroup: string,
    messages: XReadGroupResult[],
    cb: (data: DataType) => Promise<void>,
  ): Promise<void> {
    const [, entries] = messages[0];
    for (const [id, fields] of entries) {
      const jobData: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        const key = fields[i];
        jobData[key] = fields[i + 1];
      }
      const data = JSON.parse(jobData['data']);
      try {
        await cb(data);
        await client.xack(streamName, consumerGroup, id);
      } catch (e) {
        this.emit('error', e);
      }
    }
  }

  trimStream(): void {
    const streamName = this.name;
    this.client.then(async client => {
      while (!this.closing) {
        const now = Date.now();
        const cutoffTime =
          now - this.consumerOpts.maxRetentionMs || 1000 * 60 * 60 * 24;
        const oldestMessages = await client.xrange(
          streamName,
          '-',
          '+',
          'COUNT',
          1,
        );

        if (oldestMessages.length > 0) {
          const oldestMessageId = oldestMessages[0][0];
          const [oldestTimestamp] = oldestMessageId.split('-').map(Number);

          if (oldestTimestamp < cutoffTime) {
            await client.xtrim(streamName, 'MINID', `${cutoffTime}-0`);
          }
        }
        await delay(this.consumerOpts.trimIntervalMs || 60000);
      }
    });
  }
}
