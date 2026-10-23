import { Cluster } from 'ioredis';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { Queue, Worker, QueueEvents, Relay } from '../src/classes';
import { delay, randomUUID } from '../src/utils';

describe('Cluster integration tests', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  // Redis cluster nodes from docker-compose
  const clusterNodes = [
    { host: '127.0.0.1', port: 7001 },
    { host: '127.0.0.1', port: 7002 },
    { host: '127.0.0.1', port: 7003 },
  ];

  let cluster: Cluster;
  let queue: Queue;
  let queueName: string;
  let clusterAvailable = false;

  beforeAll(async () => {
    try {
      cluster = new Cluster(clusterNodes, {
        redisOptions: {
          maxRetriesPerRequest: null,
        },
        // NAT mapping for Docker on macOS - map container IPs (172.30.0.x) to localhost
        natMap: {
          '172.30.0.11:7001': { host: '127.0.0.1', port: 7001 },
          '172.30.0.12:7002': { host: '127.0.0.1', port: 7002 },
          '172.30.0.13:7003': { host: '127.0.0.1', port: 7003 },
          '172.30.0.14:7004': { host: '127.0.0.1', port: 7004 },
          '172.30.0.15:7005': { host: '127.0.0.1', port: 7005 },
          '172.30.0.16:7006': { host: '127.0.0.1', port: 7006 },
        },
      });

      // Wait for cluster to be ready with timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Cluster connection timeout'));
        }, 5000);

        cluster.once('ready', () => {
          clearTimeout(timeout);
          clusterAvailable = true;
          resolve();
        });
        cluster.once('error', err => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (err) {
      console.warn(
        'Redis cluster not available, skipping cluster integration tests:',
        (err as Error).message,
      );
    }
  }, 10000);

  beforeEach(async ctx => {
    if (!clusterAvailable) {
      ctx.skip();
      return;
    }
    // Use hash tag in queue name to ensure all keys hash to the same slot in Redis Cluster
    queueName = `{test-cluster-${randomUUID()}}`;
    queue = new Queue(queueName, { connection: cluster, prefix });
  });

  afterEach(async () => {
    if (queue) {
      await queue.close();
    }
  });

  afterAll(async () => {
    if (cluster) {
      await cluster.quit();
    }
  });

  describe('when using a real Redis cluster', () => {
    it('reads relay inboxes using a native Cluster connection', async () => {
      const relay = new Relay({
        connection: cluster,
        prefix,
        namespace: `relay-${randomUUID().replace(/-/g, '')}`,
      });
      try {
        await relay.waitUntilReady();
        let receive!: (message: unknown) => void;
        const received = new Promise(resolve => {
          receive = resolve;
        });
        await relay.subscribe('cluster.topic', receive);
        await relay.publish('cluster.topic', 'message');
        await expect(received).resolves.toMatchObject({
          topic: 'cluster.topic',
          data: 'message',
        });
      } finally {
        await relay.close();
      }
    });

    it('registers Workers using a native Cluster connection', async () => {
      const backend = queue.getBackend();
      await backend.registerWorker('w1', 30_000, { name: 'cluster' });
      expect(await backend.heartbeatWorker('w1', 30_000)).toBe(true);
      expect(await backend.getWorkerRegistrations()).toMatchObject([
        { id: 'w1', info: { name: 'cluster' } },
      ]);
      expect(await backend.sweepWorkers(10)).toEqual([]);
      expect(await backend.unregisterWorker('w1')).toBe(true);
    });

    it('should add and process jobs', async ctx => {
      if (!clusterAvailable) {
        ctx.skip();
        return;
      }
      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
        },
        {
          autorun: false,
          connection: cluster,
          prefix,
        },
      );

      await worker.waitUntilReady();

      const queueEvents = new QueueEvents(queueName, {
        connection: cluster,
        prefix,
      });
      await queueEvents.waitUntilReady();

      const completing = new Promise<void>(resolve => {
        queueEvents.once('completed', ({ jobId }) => {
          resolve();
        });
      });

      const job = await queue.add('test-job', { value: 21 });
      expect(job.id).toBeDefined();

      worker.run();
      await completing;

      await queueEvents.close();
      await worker.close();
    });

    it('should handle multiple jobs in parallel', async ctx => {
      if (!clusterAvailable) {
        ctx.skip();
        return;
      }

      const processedJobs: number[] = [];

      const worker = new Worker(
        queueName,
        async job => {
          processedJobs.push(job.data.index);
          return job.data.index;
        },
        {
          connection: cluster,
          prefix,
          concurrency: 5,
        },
      );

      await worker.waitUntilReady();

      const jobs = await queue.addBulk(
        Array.from({ length: 10 }, (_, i) => ({
          name: 'bulk-job',
          data: { index: i },
        })),
      );

      expect(jobs).toHaveLength(10);

      // Wait for all jobs to complete
      await new Promise<void>(resolve => {
        let completed = 0;
        worker.on('completed', () => {
          completed++;
          if (completed === 10) {
            resolve();
          }
        });
      });

      expect(processedJobs).toHaveLength(10);

      await worker.close();
    });

    it('should get workers from cluster', async ctx => {
      if (!clusterAvailable) {
        ctx.skip();
        return;
      }

      const workerName = 'cluster-test-worker';
      const worker = new Worker(queueName, async () => {}, {
        connection: cluster,
        prefix,
        name: workerName,
      });

      await worker.waitUntilReady();

      const workers = await queue.getWorkers();

      expect(workers.length).toBeGreaterThanOrEqual(1);
      expect(workers.some(w => w.name === queueName)).toBe(true);

      await worker.close();
    });

    it('should handle delayed jobs', async ctx => {
      if (!clusterAvailable) {
        ctx.skip();
        return;
      }

      const worker = new Worker(
        queueName,
        async job => {
          return 'delayed-done';
        },
        {
          connection: cluster,
          prefix,
        },
      );

      await worker.waitUntilReady();

      const startTime = Date.now();
      const job = await queue.add(
        'delayed-job',
        { test: true },
        { delay: 1000 },
      );

      const result = await new Promise<string>(resolve => {
        worker.on('completed', (completedJob, returnValue) => {
          if (completedJob.id === job.id) {
            resolve(returnValue);
          }
        });
      });

      const elapsed = Date.now() - startTime;

      expect(result).toBe('delayed-done');
      expect(elapsed).toBeGreaterThanOrEqual(1000);

      await worker.close();
    });

    it('should handle job retries', async ctx => {
      if (!clusterAvailable) {
        ctx.skip();
        return;
      }

      let attempts = 0;

      const worker = new Worker(
        queueName,
        async () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Retry me');
          }
          return 'success';
        },
        {
          connection: cluster,
          prefix,
        },
      );

      await worker.waitUntilReady();

      const job = await queue.add('retry-job', { test: true }, { attempts: 3 });

      const result = await new Promise<string>(resolve => {
        worker.on('completed', (completedJob, returnValue) => {
          if (completedJob.id === job.id) {
            resolve(returnValue);
          }
        });
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);

      await worker.close();
    });

    it('should get queue counts', async ctx => {
      if (!clusterAvailable) {
        ctx.skip();
        return;
      }

      await queue.addBulk([
        { name: 'job1', data: {} },
        { name: 'job2', data: {} },
        { name: 'job3', data: {} },
      ]);

      const counts = await queue.getJobCounts('waiting', 'active', 'completed');

      expect(counts.waiting).toBe(3);
      expect(counts.active).toBe(0);
      expect(counts.completed).toBe(0);
    });
  });
});

describe('Cluster with authentication integration tests', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  // Redis cluster nodes with authentication from docker-compose
  const clusterAuthNodes = [
    { host: '127.0.0.1', port: 7101 },
    { host: '127.0.0.1', port: 7102 },
    { host: '127.0.0.1', port: 7103 },
  ];

  const clusterPassword = 'testpassword';

  let cluster: Cluster;
  let queue: Queue;
  let queueName: string;
  let clusterAvailable = false;

  beforeAll(async () => {
    try {
      cluster = new Cluster(clusterAuthNodes, {
        redisOptions: {
          maxRetriesPerRequest: null,
          password: clusterPassword,
        },
        // NAT mapping for Docker on macOS - map container IPs (172.31.0.x) to localhost
        natMap: {
          '172.31.0.11:7101': { host: '127.0.0.1', port: 7101 },
          '172.31.0.12:7102': { host: '127.0.0.1', port: 7102 },
          '172.31.0.13:7103': { host: '127.0.0.1', port: 7103 },
          '172.31.0.14:7104': { host: '127.0.0.1', port: 7104 },
          '172.31.0.15:7105': { host: '127.0.0.1', port: 7105 },
          '172.31.0.16:7106': { host: '127.0.0.1', port: 7106 },
        },
      });

      // Wait for cluster to be ready with timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Cluster connection timeout'));
        }, 5000);

        cluster.once('ready', () => {
          clearTimeout(timeout);
          clusterAvailable = true;
          resolve();
        });
        cluster.once('error', err => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (err) {
      console.warn(
        'Redis cluster with auth not available, skipping cluster auth integration tests:',
        (err as Error).message,
      );
    }
  }, 10000);

  beforeEach(async ctx => {
    if (!clusterAvailable) {
      ctx.skip();
      return;
    }
    // Use hash tag in queue name to ensure all keys hash to the same slot in Redis Cluster
    queueName = `{test-cluster-auth-${randomUUID()}}`;
    queue = new Queue(queueName, { connection: cluster, prefix });
  });

  afterEach(async () => {
    if (queue) {
      await queue.close();
    }
  });

  afterAll(async () => {
    if (cluster) {
      await cluster.quit();
    }
  });

  describe('when using a Redis cluster with authentication', () => {
    it('should add and process jobs with authenticated cluster', async ctx => {
      if (!clusterAvailable) {
        ctx.skip();
        return;
      }

      const worker = new Worker(
        queueName,
        async job => {
          return job.data.value * 2;
        },
        {
          autorun: false,
          connection: cluster,
          prefix,
        },
      );

      await worker.waitUntilReady();

      const queueEvents = new QueueEvents(queueName, {
        connection: cluster,
        prefix,
      });
      await queueEvents.waitUntilReady();

      const completing = new Promise<void>(resolve => {
        queueEvents.once('completed', () => {
          resolve();
        });
      });

      const job = await queue.add('test-job', { value: 21 });
      expect(job.id).toBeDefined();

      worker.run();
      await completing;

      const completedJob = await job.getState();
      expect(completedJob).toBe('completed');

      await queueEvents.close();
      await worker.close();
    });

    it('should handle worker blocking connection with authentication', async ctx => {
      if (!clusterAvailable) {
        ctx.skip();
        return;
      }

      // This test specifically validates that the worker's blocking connection
      // properly inherits authentication when duplicating the cluster connection
      const processedJobs: string[] = [];

      const worker = new Worker(
        queueName,
        async job => {
          processedJobs.push(job.id!);
          return 'done';
        },
        {
          connection: cluster,
          prefix,
          name: 'auth-test-worker',
        },
      );

      // Wait for worker to be ready - this is where the NOAUTH error would occur
      // if authentication is not properly passed to the duplicated connection
      await worker.waitUntilReady();

      // Add multiple jobs to test the blocking connection
      await queue.addBulk([
        { name: 'job1', data: { id: 1 } },
        { name: 'job2', data: { id: 2 } },
        { name: 'job3', data: { id: 3 } },
      ]);

      // Wait for all jobs to be processed
      await new Promise<void>(resolve => {
        let completed = 0;
        worker.on('completed', () => {
          completed++;
          if (completed === 3) {
            resolve();
          }
        });
      });

      expect(processedJobs).toHaveLength(3);

      await worker.close();
    });

    it('should handle QueueEvents with authentication', async ctx => {
      if (!clusterAvailable) {
        ctx.skip();
        return;
      }

      const queueEvents = new QueueEvents(queueName, {
        connection: cluster,
        prefix,
      });

      // This will trigger the duplicate connection for QueueEvents
      await queueEvents.waitUntilReady();

      const events: string[] = [];

      queueEvents.on('waiting', ({ jobId }) => {
        events.push(`waiting:${jobId}`);
      });

      queueEvents.on('completed', ({ jobId }) => {
        events.push(`completed:${jobId}`);
      });

      const worker = new Worker(
        queueName,
        async () => {
          return 'done';
        },
        {
          connection: cluster,
          prefix,
        },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test-job', { value: 1 });

      // Wait for completion event
      await new Promise<void>(resolve => {
        queueEvents.once('completed', () => {
          resolve();
        });
      });

      expect(events).toContain(`completed:${job.id}`);

      await queueEvents.close();
      await worker.close();
    });
  });
});
