/**
 * Smoke tests that exercise core BullMQ operations using the Bun Redis
 * adapter instead of the default ioredis driver.
 *
 * Run with: bun test --timeout 20000 tests/bun-redis.test.ts
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
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
const prefix = `bull-bun-${process.pid}`;

let rawClient: RedisClient;
let client: IRedisClient;

function createRawClient(host = redisHost, port = redisPort): RedisClient {
  return new RedisClient(`redis://${host}:${port}`);
}

async function createConnectedClient(): Promise<{
  raw: RedisClient;
  client: IRedisClient;
}> {
  const raw = createRawClient();
  const wrapped = createBunRedisClient(raw);
  await wrapped.connect();
  return { raw, client: wrapped };
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
  const result = await createConnectedClient();
  rawClient = result.raw;
  client = result.client;

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

describe('bun redis adapter', () => {
  describe('basic IRedisClient operations', () => {
    it('should report ready status', () => {
      expect(client.status).toBe('ready');
    });

    it('should get/set string values', async () => {
      const key = `${prefix}:test:string`;
      await client.set(key, 'hello');
      const val = await client.get(key);
      expect(val).toBe('hello');
      await client.del(key);
    });

    it('should hset/hget/hgetall', async () => {
      const key = `${prefix}:test:hash`;
      await client.hset(key, { field1: 'a', field2: 'b' });
      expect(await client.hget(key, 'field1')).toBe('a');
      expect(await client.hgetall(key)).toEqual({ field1: 'a', field2: 'b' });
      await client.del(key);
    });

    it('should zrange with WITHSCORES', async () => {
      const key = `${prefix}:test:zset`;
      await rawClient.send('ZADD', [key, '1', 'a', '2', 'b']);

      const plain = await client.zrange(key, 0, -1);
      expect(plain).toEqual(['a', 'b']);

      const withScores = await client.zrange(key, 0, -1, { WITHSCORES: true });
      expect(withScores).toEqual(['a', '1', 'b', '2']);

      await client.del(key);
    });

    it('should duplicate', async () => {
      const dup = client.duplicate();
      await dup.connect();
      expect(dup.status).toBe('ready');
      await dup.set(`${prefix}:test:dup`, 'ok');
      expect(await client.get(`${prefix}:test:dup`)).toBe('ok');
      await client.del(`${prefix}:test:dup`);
      await dup.quit();
    });
  });

  describe('Queue operations via bun adapter', () => {
    let queue: Queue;
    let queueName: string;

    beforeEach(async () => {
      queueName = `test-bun-${randomUUID()}`;
      queue = new Queue(queueName, {
        connection: client,
        prefix,
      });
    });

    afterEach(async () => {
      if (queue) {
        await queue.close();
        await cleanQueue(queueName);
      }
    });

    it('should add and retrieve a job', async () => {
      const job = await queue.add('test-job', { foo: 'bar' });
      expect(job.id).toBeDefined();

      const fetched = await Job.fromId(queue, job.id);
      expect(fetched).toBeDefined();
      expect(fetched?.data).toEqual({ foo: 'bar' });
    });
  });

  describe('Worker processing via bun adapter', () => {
    it('should process a job to completion', async () => {
      const queueName = `test-bun-worker-${randomUUID()}`;
      const queue = new Queue(queueName, {
        connection: client,
        prefix,
      });

      const worker = new Worker(
        queueName,
        async (job: Job) => {
          return { result: job.data.input * 2 };
        },
        { connection: client, prefix, autorun: false },
      );

      await queue.add('double', { input: 21 });
      worker.run();

      const completed = await new Promise<Job>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out waiting for job completion')),
          10000,
        );
        worker.on('completed', (j: Job) => {
          clearTimeout(timeout);
          resolve(j);
        });
        worker.on('failed', (_, err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(completed.returnvalue).toEqual({ result: 42 });

      await worker.close();
      await queue.close();
      await cleanQueue(queueName);
    });
  });

  describe('FlowProducer via bun adapter', () => {
    it('should create a parent-child flow', async () => {
      const parentQueueName = `test-bun-flow-parent-${randomUUID()}`;
      const childQueueName = `test-bun-flow-child-${randomUUID()}`;

      const flow = new FlowProducer({ connection: client, prefix });

      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: { parent: true },
        children: [
          {
            name: 'child-job',
            queueName: childQueueName,
            data: { child: true },
          },
        ],
      });

      expect(tree.job.id).toBeDefined();
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].job.id).toBeDefined();

      await flow.close();
      await cleanQueue(parentQueueName);
      await cleanQueue(childQueueName);
    });
  });
});
