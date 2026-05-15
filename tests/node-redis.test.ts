/**
 * Smoke tests that exercise core BullMQ operations using the node-redis
 * adapter instead of the default ioredis driver.
 *
 * Run with:  npx vitest run tests/node-redis.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type RedisClientType } from 'redis';
import {
  Queue,
  Worker,
  FlowProducer,
  Job,
  RedisConnection,
} from '../src/classes';
import { createNodeRedisClient } from '../src/classes/node-redis-client';
import { IRedisClient } from '../src/interfaces/redis-client';
import { randomUUID } from '../src/utils';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = Number(process.env.REDIS_PORT) || 6379;
const prefix = `bull-nr-${process.pid}`;

let rawClient: RedisClientType;
let client: IRedisClient;

// Helper: create a node-redis backed IRedisClient and connect it
async function createConnectedClient(): Promise<{
  raw: RedisClientType;
  client: IRedisClient;
}> {
  const raw = createClient({
    url: `redis://${redisHost}:${redisPort}`,
  }) as RedisClientType;
  const wrapped = createNodeRedisClient(raw);
  await wrapped.connect();
  return { raw, client: wrapped };
}

// Helper: clean up queue keys
async function cleanQueue(name: string) {
  const pattern = `${prefix}:${name}:*`;
  for await (const keys of rawClient.scanIterator({ MATCH: pattern })) {
    const batch = Array.isArray(keys) ? keys : [keys];
    if (batch.length > 0) {
      await rawClient.del(batch);
    }
  }
}

// Install clientFactory so Queue/Worker/FlowProducer create node-redis
// connections when given option objects (host/port)
beforeAll(async () => {
  const result = await createConnectedClient();
  rawClient = result.raw;
  client = result.client;

  RedisConnection.clientFactory = () => {
    const raw = createClient({
      url: `redis://${redisHost}:${redisPort}`,
    });
    return createNodeRedisClient(raw);
  };
});

afterAll(async () => {
  RedisConnection.clientFactory = undefined;
  await client.quit();
});

describe('node-redis adapter', () => {
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

    it('should set with PX expiry', async () => {
      const key = `${prefix}:test:px`;
      await client.set(key, 'expires', { PX: 60000 });
      const val = await client.get(key);
      expect(val).toBe('expires');
      await client.del(key);
    });

    it('should hset/hget/hgetall', async () => {
      const key = `${prefix}:test:hash`;
      await client.hset(key, { field1: 'a', field2: 'b' });
      expect(await client.hget(key, 'field1')).toBe('a');
      expect(await client.hgetall(key)).toEqual({ field1: 'a', field2: 'b' });
      await client.del(key);
    });

    it('should hmget', async () => {
      const key = `${prefix}:test:hmget`;
      await client.hset(key, { a: '1', b: '2', c: '3' });
      const vals = await client.hmget(key, 'a', 'c', 'missing');
      expect(vals).toEqual(['1', '3', null]);
      await client.del(key);
    });

    it('should hdel/hexists', async () => {
      const key = `${prefix}:test:hdel`;
      await client.hset(key, { x: '1' });
      expect(await client.hexists(key, 'x')).toBe(1);
      await client.hdel(key, 'x');
      expect(await client.hexists(key, 'x')).toBe(0);
      await client.del(key);
    });

    it('should lrange/llen', async () => {
      const key = `${prefix}:test:list`;
      await rawClient.rPush(key, ['a', 'b', 'c']);
      expect(await client.llen(key)).toBe(3);
      expect(await client.lrange(key, 0, -1)).toEqual(['a', 'b', 'c']);
      await client.del(key);
    });

    it('should zrange with WITHSCORES', async () => {
      const key = `${prefix}:test:zset`;
      await rawClient.zAdd(key, [
        { score: 1, value: 'a' },
        { score: 2, value: 'b' },
      ]);
      const plain = await client.zrange(key, 0, -1);
      expect(plain).toEqual(['a', 'b']);
      const withScores = await client.zrange(key, 0, -1, { WITHSCORES: true });
      expect(withScores).toEqual(['a', '1', 'b', '2']);
      await client.del(key);
    });

    it('should smembers', async () => {
      const key = `${prefix}:test:set`;
      await rawClient.sAdd(key, ['x', 'y', 'z']);
      const members = await client.smembers(key);
      expect(members.sort()).toEqual(['x', 'y', 'z']);
      await client.del(key);
    });

    it('should scan', async () => {
      const keyA = `${prefix}:test:scan:a`;
      const keyB = `${prefix}:test:scan:b`;
      await client.set(keyA, '1');
      await client.set(keyB, '2');
      // SCAN is probabilistic; iterate until cursor returns to '0'
      let cursor: string | number = '0';
      const keys: string[] = [];
      do {
        const [nextCursor, batch] = await client.scan(cursor, {
          MATCH: `${prefix}:test:scan:*`,
          COUNT: 100,
        });
        cursor = nextCursor;
        keys.push(...batch);
      } while (String(cursor) !== '0');
      expect(keys.sort()).toEqual([keyA, keyB].sort());
      await client.del(keyA, keyB);
    });

    it('should info', async () => {
      const info = await client.info();
      expect(info).toContain('redis_version');
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

  describe('Lua script engine', () => {
    it('should defineCommand and runCommand', async () => {
      const dup = client.duplicate();
      await dup.connect();

      dup.defineCommand('testScript', {
        numberOfKeys: 1,
        lua: `
          redis.call('SET', KEYS[1], ARGV[1])
          return redis.call('GET', KEYS[1])
        `,
      });

      const key = `${prefix}:test:lua`;
      const result = await dup.runCommand('testScript', [key, 'luaval']);
      expect(result).toBe('luaval');
      await client.del(key);
      await dup.quit();
    });

    it('should handle EVALSHA fallback to EVAL', async () => {
      // First call uses EVAL (script not cached), second uses EVALSHA
      const dup = client.duplicate();
      await dup.connect();

      dup.defineCommand('testFallback', {
        numberOfKeys: 1,
        lua: `return redis.call('SET', KEYS[1], ARGV[1])`,
      });

      const key = `${prefix}:test:lua:fallback`;
      await dup.runCommand('testFallback', [key, 'v1']);
      await dup.runCommand('testFallback', [key, 'v2']);
      expect(await client.get(key)).toBe('v2');
      await client.del(key);
      await dup.quit();
    });
  });

  describe('Queue operations via node-redis', () => {
    let queue: Queue;
    let queueName: string;

    beforeEach(async () => {
      queueName = `test-nr-${randomUUID()}`;
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
      expect(job.name).toBe('test-job');

      const fetched = await Job.fromId(queue, job.id);
      expect(fetched).toBeDefined();
      expect(fetched.data).toEqual({ foo: 'bar' });
    });

    it('should add bulk jobs', async () => {
      const jobs = await queue.addBulk([
        { name: 'bulk1', data: { n: 1 } },
        { name: 'bulk2', data: { n: 2 } },
        { name: 'bulk3', data: { n: 3 } },
      ]);
      expect(jobs).toHaveLength(3);
      expect(jobs.map(j => j.name)).toEqual(['bulk1', 'bulk2', 'bulk3']);
    });

    it('should get job counts', async () => {
      await queue.add('count-job', { x: 1 });
      const counts = await queue.getJobCounts('wait', 'active', 'completed');
      expect(counts.wait).toBeGreaterThanOrEqual(1);
    });

    it('should pause and resume', async () => {
      await queue.pause();
      expect(await queue.isPaused()).toBe(true);
      await queue.resume();
      expect(await queue.isPaused()).toBe(false);
    });
  });

  describe('Worker processing via node-redis', () => {
    it('should process a job to completion', async () => {
      const queueName = `test-nr-worker-${randomUUID()}`;
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

      const job = await queue.add('double', { input: 21 });

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
        worker.on('failed', (j, err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      expect(completed.returnvalue).toEqual({ result: 42 });

      await worker.close();
      await queue.close();
      await cleanQueue(queueName);
    }, 20000);
  });

  describe('FlowProducer via node-redis', () => {
    it('should create a parent-child flow', async () => {
      const parentQueueName = `test-nr-flow-parent-${randomUUID()}`;
      const childQueueName = `test-nr-flow-child-${randomUUID()}`;

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

      expect(tree).toBeDefined();
      expect(tree.job.id).toBeDefined();
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].job.id).toBeDefined();

      await flow.close();
      await cleanQueue(parentQueueName);
      await cleanQueue(childQueueName);
    });
  });
});
