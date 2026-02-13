import { default as IORedis } from 'ioredis';
import { v4 } from 'uuid';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Queue } from '../src';
import { removeAllQueueData } from '../src/utils';

describe('Repeat/JobScheduler error forwarding', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  afterAll(async () => {
    await connection.quit();
  });

  it('Queue should forward Repeat "error" to queue.on("error")', async () => {
    const queueName = `test-forward-repeat-${v4()}`;
    const queue = new Queue(queueName, { connection, prefix });

    // Force repeat instance creation so the buggy listener is attached
    const repeat = await queue.repeat;
    await repeat.waitUntilReady();

    const spy = vi.fn();
    queue.on('error', spy);

    const err = new Error('repeat boom');

    // Trigger the child error event directly
    (queue as any)._repeat.emit('error', err);

    // This EXPECTATION FAILS on current buggy code (spy called 0 times)
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(err);

    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  it('Queue should forward JobScheduler "error" to queue.on("error")', async () => {
    const queueName = `test-forward-scheduler-${v4()}`;
    const queue = new Queue(queueName, { connection, prefix });

    // Force jobScheduler instance creation so the buggy listener is attached
    const jobScheduler = await queue.jobScheduler;
    await jobScheduler.waitUntilReady();

    const spy = vi.fn();
    queue.on('error', spy);

    const err = new Error('scheduler boom');

    // Trigger the child error event directly
    (queue as any)._jobScheduler.emit('error', err);

    // This EXPECTATION FAILS on current buggy code (spy called 0 times)
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(err);

    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });
});
