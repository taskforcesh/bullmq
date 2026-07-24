import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { Queue, QueueEvents, Worker } from '../src/classes';
import { delay, randomUUID } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';
import { cleanupQueue } from './utils/cleanup-queue';
import { IRedisClient } from '../src/interfaces';

/**
 * Backend-agnostic obliterate behaviour. The strict "no keys remain" cleanup
 * checks and the flow-aware parent handling assert on the raw Redis keyspace,
 * so they live in `obliterate.redis.test.ts`.
 */
describe('Obliterate', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  let connection: IRedisClient;
  beforeAll(async () => {
    connection = createTestConnection();
  });

  beforeEach(async () => {
    queueName = `test-${randomUUID()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await queueEvents.close();
    await cleanupQueue(queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  it('should raise exception if queue has active jobs', async () => {
    await queue.waitUntilReady();

    await queue.add('test', { foo: 'bar' });
    const job = await queue.add('test', { qux: 'baz' });

    await queue.add('test', { foo: 'bar2' });
    await queue.add('test', { foo: 'bar3' }, { delay: 5000 });

    let first = true;
    const worker = new Worker(
      queue.name,
      async () => {
        if (first) {
          first = false;
          throw new Error('failed first');
        }
        return delay(250);
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    await job.waitUntilFinished(queueEvents);

    await expect(queue.obliterate()).rejects.toThrow(
      'Cannot obliterate queue with active jobs',
    );

    await worker.close();
  });

  it('should remove job logs', async () => {
    const queueEvents = new QueueEvents(queue.name, { connection, prefix });

    const worker = new Worker(
      queue.name,
      async job => {
        await delay(100);
        return job.log('Lorem Ipsum Dolor Sit Amet');
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const job = await queue.add('test', {});

    await job.waitUntilFinished(queueEvents);

    await queue.obliterate({ force: true });

    const { logs } = await queue.getJobLogs(job.id!);
    expect(logs).toHaveLength(0);

    await queueEvents.close();
    await worker.close();
  });
});
