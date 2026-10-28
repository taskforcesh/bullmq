'use strict';

/**
 * Redis-only `Queue` getter tests.
 *
 * This one drives a mid-flight connection drop/restore through
 * `getBlockingRedisClient`, a Redis-specific escape hatch that hands back the
 * raw blocking client to call `.disconnect()`/`.connect()` directly. That
 * manipulates Redis connection internals with no portable equivalent, so it is
 * scoped to Redis.
 */
import { getBlockingRedisClient } from './utils/get-redis-client';
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
import { delay, randomUUID, removeAllQueueData } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';
import { IRedisClient } from '../src/interfaces';

describe('Jobs getters (redis-only)', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let queue: Queue;
  let queueName: string;

  let connection: IRedisClient;
  beforeAll(async () => {
    connection = createTestConnection();
  });

  beforeEach(async () => {
    queueName = `test-${randomUUID()}`;
    queue = new Queue(queueName, { connection, prefix });
  });

  afterEach(async () => {
    await queue.close();
    await removeAllQueueData(createTestConnection(), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('.getWorkers', () => {
    describe('when disconnection happens', () => {
      it('keeps listing the worker while its connection reconnects', async () => {
        const worker = new Worker(queueName, async () => {}, {
          autorun: false,
          connection,
          prefix,
        });
        await new Promise<void>(resolve => {
          worker.on('ready', () => {
            resolve();
          });
        });
        await worker.waitUntilReady();
        const client = await getBlockingRedisClient(worker);

        const workers = await queue.getWorkers();
        expect(workers).toHaveLength(1);

        // The worker's registration lives in the registry with a lease, not
        // on the connection: a dropped connection does not unlist it.
        await client.disconnect();
        await delay(10);

        const nextWorkers = await queue.getWorkers();
        expect(nextWorkers).toHaveLength(1);

        await client.connect();
        await delay(20);
        const nextWorkers2 = await queue.getWorkers();
        expect(nextWorkers2).toHaveLength(1);

        await worker.close();
      });
    });
  });
});
