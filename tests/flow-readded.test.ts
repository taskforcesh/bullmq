import { describe, expect, it } from 'vitest';
import { FlowProducer, Queue, Worker } from '../src/classes';
import { randomUUID } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';
import { checkReaddedFlow } from './utils/readded-flow';

describe('re-added flows', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  it.each([
    [true, false, 'siblings'],
    [false, false, 'siblings'],
    [true, true, 'siblings'],
    [false, true, 'siblings'],
    [true, false, 'nested'],
    [true, true, 'split'],
  ] as const)(
    'registers every sibling before releasing a parent (completedFirst=%s, bulk=%s, structure=%s)',
    async (completedFirst, bulk, structure) => {
      const connection = createTestConnection();
      const queueName = `readded-${randomUUID()}`;
      const queue = new Queue(queueName, { connection, prefix });
      const flow = new FlowProducer({ connection, prefix });
      const worker = new Worker(queueName, undefined, {
        connection,
        prefix,
        autorun: false,
      });
      const errors: Error[] = [];
      worker.on('error', error => errors.push(error));
      try {
        await checkReaddedFlow(
          queue,
          flow,
          worker,
          completedFirst,
          bulk,
          structure,
        );
        expect(errors).toEqual([]);
      } finally {
        await worker.close();
        await flow.close();
        await queue.obliterate({ force: true });
        await queue.close();
        await connection.quit();
      }
    },
  );
});
