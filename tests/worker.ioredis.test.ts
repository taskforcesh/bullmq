import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { Queue, Worker } from '../src/classes';
import { IRedisClient } from '../src/interfaces';
import { delay, randomUUID, removeAllQueueData } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';

describe('workers (ioredis-only)', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queueName: string;
  let connection: IRedisClient;

  beforeAll(async () => {
    connection = createTestConnection();
  });

  beforeEach(async () => {
    queueName = `test-${randomUUID()}`;
  });

  afterEach(async () => {
    await removeAllQueueData(createTestConnection(), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  describe('when the blocking connection is parked in "reconnecting" (#4585)', () => {
    it('recovers and keeps processing jobs after a Redis outage longer than drainDelay', async () => {
      const queue = new Queue(queueName, { connection, prefix });
      await queue.waitUntilReady();

      let processed = 0;
      const worker = new Worker(
        queueName,
        async () => {
          processed++;
        },
        { connection, prefix, drainDelay: 1 },
      );
      worker.on('error', () => {});
      await worker.waitUntilReady();

      try {
        await queue.add('before', {});
        await delay(1500);
        expect(processed).toBe(1);

        const backend = worker.getBackend() as any;
        const bclient = (await backend.blockingClient) as any;
        bclient.options.retryStrategy = () => 2500;
        bclient.stream.destroy(new Error('simulated redis outage'));

        await delay(5000);
        expect(bclient.status).toBe('ready');

        await queue.add('after', {});
        await delay(4000);
        expect(processed).toBe(2);
      } finally {
        await worker.close();
        await queue.close();
      }
    }, 30000);
  });
});
