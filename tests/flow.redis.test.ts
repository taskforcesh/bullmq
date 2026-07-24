'use strict';

/**
 * Redis-only flow tests.
 *
 * These assert on Redis storage internals with no portable equivalent: they
 * reach for the raw Redis client via `getRedisClient` and inspect the queue
 * `:meta` hash directly with `hgetall`. On PostgreSQL there is no such hash
 * (queue metadata lives in relational tables), so this test is scoped to Redis.
 */
import { getRedisClient } from './utils/get-redis-client';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { FlowProducer, Queue } from '../src/classes';
import { randomUUID, removeAllQueueData } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';
import { IRedisClient } from '../src/interfaces';

describe('flows (redis-only)', () => {
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

  it('should add meta key to both parents and children', async () => {
    const name = 'child-job';
    const topQueueName = `top-queue-${randomUUID()}`;

    const flow = new FlowProducer({ connection, prefix });
    await flow.add({
      name: 'root-job',
      queueName: topQueueName,
      data: {},
      children: [
        {
          name,
          data: { idx: 0, foo: 'bar' },
          queueName,
          children: [
            {
              name,
              data: { idx: 1, foo: 'baz' },
              queueName,
              children: [{ name, data: { idx: 2, foo: 'qux' }, queueName }],
            },
          ],
        },
      ],
    });

    const client = await getRedisClient(flow);
    const metaTop = await client.hgetall(`${prefix}:${topQueueName}:meta`);
    expect(metaTop).toMatchObject({ 'opts.maxLenEvents': '10000' });

    const metaChildren = await client.hgetall(`${prefix}:${queueName}:meta`);
    expect(metaChildren).toMatchObject({
      'opts.maxLenEvents': '10000',
    });

    await flow.close();

    await removeAllQueueData(createTestConnection(), topQueueName);
  });
});
