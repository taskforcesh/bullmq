/**
 * Redis-only tests for `Queue`.
 *
 * These exercise Redis-specific internals (the raw key layout, deprecated
 * Redis keys, etc.) that have no backend-agnostic equivalent and therefore
 * cannot run against non-Redis backends. They live in a dedicated
 * `*.redis.test.ts` suite that is excluded from the cross-backend runs (see
 * `vitest.postgres.config.ts`).
 */
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { Queue } from '../src/classes';
import { randomUUID, removeAllQueueData } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';
import { getRedisClient } from './utils/get-redis-client';
import { IRedisClient } from '../src/interfaces';

describe('queues (redis-only)', () => {
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
    await queue.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await removeAllQueueData(createTestConnection(), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('.removeDeprecatedPriorityKey', () => {
    it('removes old priority key', async () => {
      const client = await getRedisClient(queue);
      await client.zadd(`${prefix}:${queue.name}:priority`, 1, 'a');
      await client.zadd(`${prefix}:${queue.name}:priority`, 2, 'b');

      const count = await client.zcard(`${prefix}:${queue.name}:priority`);

      expect(count).toEqual(2);

      await queue.removeDeprecatedPriorityKey();

      const updatedCount = await client.zcard(
        `${prefix}:${queue.name}:priority`,
      );

      expect(updatedCount).toEqual(0);
    });
  });
});
