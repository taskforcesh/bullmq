/**
 * Redis-only tests for the behaviour when Redis reaches `maxmemory` with the
 * `noeviction` policy.
 *
 * Producers must be rejected, but workers must keep processing the jobs that
 * are already in the queue, and the operations that free memory (remove,
 * clean, drain, obliterate) must keep working.
 *
 * The tests lower `maxmemory` on the server the suite is running against and
 * restore the original configuration after each test. They are skipped when
 * the server does not allow the `CONFIG` command.
 */
import { default as IORedis } from 'ioredis';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { Queue, Worker, Job } from '../src/classes';
import { delay, randomUUID } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';
import { cleanupQueue } from './utils/cleanup-queue';
import { IRedisClient } from '../src/interfaces';

describe('when Redis reaches maxmemory (redis-only)', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let admin: IORedis;
  let configAllowed = true;
  let originalMaxMemory: string;
  let originalPolicy: string;

  let queue: Queue;
  let queueName: string;
  let connection: IRedisClient;

  const enableOOM = async () => {
    await admin.config('SET', 'maxmemory-policy', 'noeviction');
    await admin.config('SET', 'maxmemory', '1');
  };

  const restoreMemory = async () => {
    await admin.config('SET', 'maxmemory', originalMaxMemory);
    await admin.config('SET', 'maxmemory-policy', originalPolicy);
  };

  beforeAll(async () => {
    connection = createTestConnection();
    admin = new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      maxRetriesPerRequest: null,
    });
    try {
      const [, maxMemory] = (await admin.config(
        'GET',
        'maxmemory',
      )) as string[];
      const [, policy] = (await admin.config(
        'GET',
        'maxmemory-policy',
      )) as string[];
      originalMaxMemory = maxMemory;
      originalPolicy = policy;
    } catch {
      configAllowed = false;
    }
  });

  beforeEach(async ctx => {
    if (!configAllowed) {
      ctx.skip();
    }
    queueName = `test-${randomUUID()}`;
    queue = new Queue(queueName, { connection, prefix });
    await queue.waitUntilReady();
  });

  afterEach(async () => {
    if (!configAllowed) {
      return;
    }
    await restoreMemory();
    await queue.close();
    await cleanupQueue(queueName);
  });

  afterAll(async () => {
    if (configAllowed) {
      await restoreMemory();
    }
    await admin.quit();
    await connection.quit();
  });

  it('rejects adding new jobs', async () => {
    await enableOOM();

    await expect(queue.add('test', { foo: 'bar' })).rejects.toThrow(
      /OOM command not allowed/,
    );
  });

  it('keeps processing the jobs that are already in the queue', async () => {
    const numJobs = 10;
    await queue.addBulk(
      Array.from({ length: numJobs }, (_, i) => ({
        name: 'test',
        data: { i },
      })),
    );

    const worker = new Worker(queueName, async (job: Job) => job.data.i, {
      connection,
      prefix,
      autorun: false,
    });
    await worker.waitUntilReady();

    const errors: Error[] = [];
    worker.on('error', err => errors.push(err));

    let completedCount = 0;
    const completed = new Promise<void>(resolve => {
      worker.on('completed', () => {
        completedCount++;
        if (completedCount === numJobs) {
          resolve();
        }
      });
    });

    await enableOOM();
    worker.run();
    await completed;

    const counts = await queue.getJobCounts('completed', 'wait', 'active');
    expect(counts).toEqual({ completed: numJobs, wait: 0, active: 0 });
    expect(errors).toEqual([]);

    await worker.close();
  });

  it('extends locks of long running jobs so they do not stall', async () => {
    await queue.add('test', {});

    const worker = new Worker(
      queueName,
      async () => {
        await delay(2500);
        return 'done';
      },
      {
        connection,
        prefix,
        autorun: false,
        lockDuration: 1000,
        stalledInterval: 500,
      },
    );
    await worker.waitUntilReady();

    let stalled = 0;
    worker.on('stalled', () => stalled++);

    const completed = new Promise<Job>(resolve => {
      worker.on('completed', job => resolve(job));
    });

    await enableOOM();
    worker.run();

    const job = await completed;
    expect(job.returnvalue).toBe('done');
    expect(job.attemptsStarted).toBe(1);
    expect(stalled).toBe(0);

    await worker.close();
  });

  it('retries failed jobs with backoff', async () => {
    await queue.add(
      'test',
      {},
      { attempts: 2, backoff: { type: 'fixed', delay: 100 } },
    );

    const worker = new Worker(
      queueName,
      async job => {
        if (job.attemptsMade === 0) {
          throw new Error('first attempt fails');
        }
        return 'ok';
      },
      { connection, prefix, autorun: false },
    );
    await worker.waitUntilReady();

    const completed = new Promise<Job>(resolve => {
      worker.on('completed', job => resolve(job));
    });

    await enableOOM();
    worker.run();

    const job = await completed;
    expect(job.returnvalue).toBe('ok');
    expect(job.attemptsMade).toBe(2);

    await worker.close();
  });

  it('allows removing, cleaning, pausing, draining and obliterating', async () => {
    const [toRemove] = await queue.addBulk([
      { name: 'test', data: {} },
      { name: 'test', data: {} },
      { name: 'test', data: {} },
    ]);
    await queue.add('delayed', {}, { delay: 60000 });

    await enableOOM();

    await toRemove.remove();
    expect(await queue.getJob(toRemove.id!)).toBeUndefined();

    await queue.pause();
    expect(await queue.isPaused()).toBe(true);

    const cleaned = await queue.clean(0, 1, 'wait');
    expect(cleaned).toHaveLength(1);

    await queue.drain(true);
    const counts = await queue.getJobCounts('wait', 'delayed');
    expect(counts).toEqual({ wait: 0, delayed: 0 });

    await queue.obliterate();
  });
});
