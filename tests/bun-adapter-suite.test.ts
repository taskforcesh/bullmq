import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { RedisClient } from 'bun';
import {
  FlowProducer,
  Job,
  Queue,
  RedisConnection,
  Worker,
} from '../src/classes';
import { createBunRedisClient } from '../src/classes/bun-redis-client';
import { IRedisClient } from '../src/interfaces/redis-client';
import { randomUUID } from '../src/utils';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = Number(process.env.REDIS_PORT) || 6379;
const prefix = `bull-bun-suite-${process.pid}`;

let client: IRedisClient;

function createRawClient(host = redisHost, port = redisPort): RedisClient {
  return new RedisClient(`redis://${host}:${port}`);
}

async function createConnectedClient(): Promise<IRedisClient> {
  const raw = createRawClient();
  const wrapped = createBunRedisClient(raw);
  await wrapped.connect();
  return wrapped;
}

async function cleanQueue(name: string) {
  const pattern = `${prefix}:${name}:*`;
  let cursor: string | number = '0';
  const keys: string[] = [];

  do {
    const [nextCursor, batch] = await client.scan(cursor, {
      MATCH: pattern,
      COUNT: 100,
    });
    cursor = nextCursor;
    keys.push(...batch);
  } while (String(cursor) !== '0');

  if (keys.length > 0) {
    await client.del(...keys);
  }
}

beforeAll(async () => {
  client = await createConnectedClient();

  RedisConnection.clientFactory = opts => {
    const host = opts?.host ?? redisHost;
    const port = opts?.port ?? redisPort;
    const raw = createRawClient(host, port);
    return createBunRedisClient(raw);
  };
});

afterAll(async () => {
  RedisConnection.clientFactory = undefined;
  await client.quit();
});

describe('bun adapter extended suite', () => {
  it('supports bulk add and wait counts', async () => {
    const queueName = `test-bun-bulk-${randomUUID()}`;
    const queue = new Queue(queueName, { connection: client, prefix });

    try {
      await queue.addBulk([
        { name: 'a', data: { i: 1 } },
        { name: 'b', data: { i: 2 } },
        { name: 'c', data: { i: 3 } },
      ]);

      const counts = await queue.getJobCounts('wait');
      expect(counts.wait).toBeGreaterThanOrEqual(3);
    } finally {
      await queue.close();
      await cleanQueue(queueName);
    }
  });

  it('supports pause and resume', async () => {
    const queueName = `test-bun-pause-${randomUUID()}`;
    const queue = new Queue(queueName, { connection: client, prefix });

    try {
      await queue.pause();
      expect(await queue.isPaused()).toBe(true);
      await queue.resume();
      expect(await queue.isPaused()).toBe(false);
    } finally {
      await queue.close();
      await cleanQueue(queueName);
    }
  });

  it('handles failed jobs', async () => {
    const queueName = `test-bun-fail-${randomUUID()}`;
    const queue = new Queue(queueName, { connection: client, prefix });

    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('boom');
      },
      { connection: client, prefix, autorun: false },
    );

    try {
      await queue.add('x', {});
      worker.run();

      const error = await new Promise<Error>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for failed event')),
          10000,
        );

        worker.on('failed', (_, err) => {
          clearTimeout(timeout);
          resolve(err);
        });
      });

      expect(error.message).toBe('boom');
    } finally {
      await worker.close();
      await queue.close();
      await cleanQueue(queueName);
    }
  });

  it('processes jobs with concurrency', async () => {
    const queueName = `test-bun-conc-${randomUUID()}`;
    const queue = new Queue(queueName, { connection: client, prefix });

    let maxConcurrent = 0;
    let running = 0;

    const worker = new Worker(
      queueName,
      async () => {
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise(resolve => setTimeout(resolve, 100));
        running -= 1;
      },
      { connection: client, prefix, autorun: false, concurrency: 3 },
    );

    try {
      await queue.addBulk(
        Array.from({ length: 6 }, (_, i) => ({
          name: `job-${i}`,
          data: { i },
        })),
      );
      worker.run();

      await new Promise<void>((resolve, reject) => {
        let completed = 0;
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for completion')),
          15000,
        );

        worker.on('completed', () => {
          completed += 1;
          if (completed === 6) {
            clearTimeout(timeout);
            resolve();
          }
        });

        worker.on('failed', (_, err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(maxConcurrent).toBeGreaterThanOrEqual(2);
    } finally {
      await worker.close();
      await queue.close();
      await cleanQueue(queueName);
    }
  });

  it('processes delayed jobs', async () => {
    const queueName = `test-bun-delay-${randomUUID()}`;
    const queue = new Queue(queueName, { connection: client, prefix });

    const worker = new Worker(queueName, async (job: Job) => job.data.v, {
      connection: client,
      prefix,
      autorun: false,
    });

    try {
      await queue.add('x', { v: 99 }, { delay: 300 });
      worker.run();

      const result = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for delayed completion')),
          10000,
        );

        worker.on('completed', (_, returnvalue) => {
          clearTimeout(timeout);
          resolve(returnvalue);
        });

        worker.on('failed', (_, err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(result).toBe(99);
    } finally {
      await worker.close();
      await queue.close();
      await cleanQueue(queueName);
    }
  });

  it('processes a flow end-to-end', async () => {
    const parentQueueName = `test-bun-flow-parent-${randomUUID()}`;
    const childQueueName = `test-bun-flow-child-${randomUUID()}`;

    const parentQueue = new Queue(parentQueueName, {
      connection: client,
      prefix,
    });
    const childQueue = new Queue(childQueueName, {
      connection: client,
      prefix,
    });
    const flow = new FlowProducer({ connection: client, prefix });

    const childWorker = new Worker(
      childQueueName,
      async () => ({ childResult: true }),
      { connection: client, prefix, autorun: false },
    );
    const parentWorker = new Worker(
      parentQueueName,
      async () => ({ parentResult: true }),
      { connection: client, prefix, autorun: false },
    );

    try {
      const tree = await flow.add({
        name: 'parent',
        queueName: parentQueueName,
        data: { step: 'parent' },
        children: [
          {
            name: 'child',
            queueName: childQueueName,
            data: { step: 'child' },
          },
        ],
      });

      childWorker.run();
      parentWorker.run();

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for parent completion')),
          15000,
        );

        parentWorker.on('completed', job => {
          if (job.id === tree.job.id) {
            clearTimeout(timeout);
            resolve();
          }
        });

        parentWorker.on('failed', (_, err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      const parentJob = await parentQueue.getJob(tree.job.id!);
      const state = await parentJob?.getState();
      expect(state).toBe('completed');
    } finally {
      await childWorker.close();
      await parentWorker.close();
      await flow.close();
      await parentQueue.close();
      await childQueue.close();
      await cleanQueue(parentQueueName);
      await cleanQueue(childQueueName);
    }
  });
});
