import { default as IORedis, Cluster, Redis } from 'ioredis';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import * as sinon from 'sinon';
import { v4 } from 'uuid';
import { Queue, Worker, QueueEvents } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Cluster support', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  const sandbox = sinon.createSandbox();

  let queue: Queue;
  let queueName: string;
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
  });

  afterEach(async () => {
    sandbox.restore();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  // Helper to get the base64 encoded queue name (matching queue-base.ts clientName logic)
  function getClientName(name: string): string {
    const base64Name = Buffer.from(name).toString('base64');
    return `${prefix}:${base64Name}`;
  }

  function buildClientLine(...parts: string[]): string {
    return parts.join(' ');
  }

  function buildClientList(lines: string[]): string {
    return lines.join('\n') + '\n';
  }

  describe('Worker connection name on cluster', () => {
    describe('when connection is a cluster instance', () => {
      it('should use Cluster.duplicate with redisOptions for connectionName', async () => {
        const duplicatedConnection = {
          on: sinon.stub(),
          once: sinon.stub(),
          status: 'ready',
          options: { connectionName: 'test-connection' },
          connect: sinon.stub().resolves(),
          disconnect: sinon.stub().resolves(),
          duplicate: sinon.stub(),
          defineCommand: sinon.stub(),
          info: sinon.stub().resolves('redis_version:7.0.0'),
          quit: sinon.stub().resolves(),
          getMaxListeners: sinon.stub().returns(10),
          setMaxListeners: sinon.stub(),
          off: sinon.stub(),
        };

        // Create a mock cluster connection that satisfies isRedisInstance check
        const mockClusterConnection = {
          isCluster: true,
          connect: sinon.stub().resolves(),
          disconnect: sinon.stub().resolves(),
          duplicate: sinon.stub().returns(duplicatedConnection),
          defineCommand: sinon.stub(),
          info: sinon.stub().resolves('redis_version:7.0.0'),
          options: {},
          status: 'ready',
          on: sinon.stub(),
          once: sinon.stub(),
          getMaxListeners: sinon.stub().returns(10),
          setMaxListeners: sinon.stub(),
          off: sinon.stub(),
        };

        const workerName = 'testWorker';
        // Create worker with the mock cluster connection
        const worker = new Worker(queueName, async () => {}, {
          autorun: false,
          connection: mockClusterConnection as unknown as Cluster,
          prefix,
          name: workerName,
        });

        // Verify that duplicate was called with the correct arguments for cluster
        expect(
          (mockClusterConnection.duplicate as sinon.SinonStub).calledOnce,
        ).toBe(true);
        const duplicateCall = (
          mockClusterConnection.duplicate as sinon.SinonStub
        ).getCall(0);

        // First argument should be undefined for cluster
        expect(duplicateCall.args[0]).toBeUndefined();

        // Second argument should contain redisOptions with connectionName
        expect(duplicateCall.args[1]).toHaveProperty('redisOptions');
        expect(duplicateCall.args[1].redisOptions).toHaveProperty(
          'connectionName',
        );
        expect(duplicateCall.args[1].redisOptions.connectionName).toContain(
          `:w:${workerName}`,
        );

        await worker.close();
      });
    });

    describe('when connection is a regular Redis instance', () => {
      it('should use Redis.duplicate with connectionName directly', async () => {
        const duplicatedConnection = {
          on: sinon.stub(),
          once: sinon.stub(),
          status: 'ready',
          options: { connectionName: 'test-connection' },
          connect: sinon.stub().resolves(),
          disconnect: sinon.stub().resolves(),
          duplicate: sinon.stub(),
          defineCommand: sinon.stub(),
          info: sinon.stub().resolves('redis_version:7.0.0'),
          quit: sinon.stub().resolves(),
          getMaxListeners: sinon.stub().returns(10),
          setMaxListeners: sinon.stub(),
          off: sinon.stub(),
        };

        // Create a mock Redis connection (non-cluster) that satisfies isRedisInstance check
        const mockRedisConnection = {
          isCluster: false,
          connect: sinon.stub().resolves(),
          disconnect: sinon.stub().resolves(),
          duplicate: sinon.stub().returns(duplicatedConnection),
          defineCommand: sinon.stub(),
          info: sinon.stub().resolves('redis_version:7.0.0'),
          options: {},
          status: 'ready',
          on: sinon.stub(),
          once: sinon.stub(),
          getMaxListeners: sinon.stub().returns(10),
          setMaxListeners: sinon.stub(),
          off: sinon.stub(),
        };

        const workerName = 'testWorker';
        // Create worker with the mock Redis connection
        const worker = new Worker(queueName, async () => {}, {
          autorun: false,
          connection: mockRedisConnection as unknown as Redis,
          prefix,
          name: workerName,
        });

        // Verify that duplicate was called with connectionName directly
        expect((mockRedisConnection.duplicate as sinon.SinonStub).calledOnce).to
          .be.true;
        const duplicateCall = (
          mockRedisConnection.duplicate as sinon.SinonStub
        ).getCall(0);

        // First argument should be an object with connectionName for regular Redis
        expect(duplicateCall.args[0]).toHaveProperty('connectionName');
        expect(duplicateCall.args[0].connectionName).toContain(
          `:w:${workerName}`,
        );

        await worker.close();
      });
    });

    describe('when worker has a name option', () => {
      it('should include worker name in connection name for cluster', async () => {
        const workerName = 'myWorker';
        const duplicatedConnection = {
          on: sinon.stub(),
          once: sinon.stub(),
          status: 'ready',
          options: { connectionName: 'test-connection' },
          connect: sinon.stub().resolves(),
          disconnect: sinon.stub().resolves(),
          duplicate: sinon.stub(),
          defineCommand: sinon.stub(),
          info: sinon.stub().resolves('redis_version:7.0.0'),
          quit: sinon.stub().resolves(),
          getMaxListeners: sinon.stub().returns(10),
          setMaxListeners: sinon.stub(),
          off: sinon.stub(),
        };

        const mockClusterConnection = {
          isCluster: true,
          connect: sinon.stub().resolves(),
          disconnect: sinon.stub().resolves(),
          duplicate: sinon.stub().returns(duplicatedConnection),
          defineCommand: sinon.stub(),
          info: sinon.stub().resolves('redis_version:7.0.0'),
          options: {},
          status: 'ready',
          on: sinon.stub(),
          once: sinon.stub(),
          getMaxListeners: sinon.stub().returns(10),
          setMaxListeners: sinon.stub(),
          off: sinon.stub(),
        };

        const worker = new Worker(queueName, async () => {}, {
          autorun: false,
          connection: mockClusterConnection as unknown as Cluster,
          prefix,
          name: workerName,
        });

        expect(
          (mockClusterConnection.duplicate as sinon.SinonStub).calledOnce,
        ).toBe(true);
        const duplicateCall = (
          mockClusterConnection.duplicate as sinon.SinonStub
        ).getCall(0);

        expect(duplicateCall.args[1].redisOptions.connectionName).toContain(
          `:w:${workerName}`,
        );

        await worker.close();
      });
    });
  });

  describe('getWorkers on cluster', () => {
    describe('when client is a cluster', () => {
      it('should fetch client list from all cluster nodes', async () => {
        const clientName = getClientName(queueName);
        const clientListNode1 = buildClientList([
          buildClientLine(
            'id=1',
            'addr=127.0.0.1:6379',
            `name=${clientName}:w:worker1`,
            'age=10',
          ),
        ]);
        const clientListNode2 = buildClientList([
          buildClientLine(
            'id=2',
            'addr=127.0.0.1:6380',
            `name=${clientName}:w:worker1`,
            'age=10',
          ),
          buildClientLine(
            'id=3',
            'addr=127.0.0.1:6380',
            `name=${clientName}:w:worker2`,
            'age=5',
          ),
        ]);
        const clientListNode3 = buildClientList([
          buildClientLine(
            'id=4',
            'addr=127.0.0.1:6381',
            'name=other-client',
            'age=20',
          ),
        ]);

        const mockNode1 = {
          client: sinon.stub().resolves(clientListNode1),
        };
        const mockNode2 = {
          client: sinon.stub().resolves(clientListNode2),
        };
        const mockNode3 = {
          client: sinon.stub().resolves(clientListNode3),
        };

        const mockClusterClient = {
          isCluster: true,
          nodes: sinon.stub().returns([mockNode1, mockNode2, mockNode3]),
        };

        // Stub the queue's client to return our mock cluster
        sandbox
          .stub(queue, 'client')
          .get(() => Promise.resolve(mockClusterClient));

        const workers = await queue.getWorkers();

        // Should return workers from the node with the most matching clients (node2)
        expect(workers).toHaveLength(2);
        expect(workers[0]).toHaveProperty('name', queueName);
        expect(workers[1]).toHaveProperty('name', queueName);

        // Verify all nodes were queried
        expect((mockNode1.client as sinon.SinonStub).calledWith('LIST')).to.be
          .true;
        expect((mockNode2.client as sinon.SinonStub).calledWith('LIST')).to.be
          .true;
        expect((mockNode3.client as sinon.SinonStub).calledWith('LIST')).to.be
          .true;
      });

      it('should return workers from node with most matching connections', async () => {
        const clientName = getClientName(queueName);
        // Simulate a scenario where connections are redirected to one node
        const clientListNode1 = buildClientList([
          buildClientLine(
            'id=1',
            'addr=127.0.0.1:6379',
            `name=${clientName}:w:w1`,
            'age=10',
          ),
        ]);
        const clientListNode2 = buildClientList([
          buildClientLine(
            'id=2',
            'addr=127.0.0.1:6380',
            `name=${clientName}:w:w1`,
            'age=10',
          ),
          buildClientLine(
            'id=3',
            'addr=127.0.0.1:6380',
            `name=${clientName}:w:w2`,
            'age=5',
          ),
          buildClientLine(
            'id=4',
            'addr=127.0.0.1:6380',
            `name=${clientName}:w:w3`,
            'age=5',
          ),
        ]);

        const mockNode1 = {
          client: sinon.stub().resolves(clientListNode1),
        };
        const mockNode2 = {
          client: sinon.stub().resolves(clientListNode2),
        };

        const mockClusterClient = {
          isCluster: true,
          nodes: sinon.stub().returns([mockNode1, mockNode2]),
        };

        sandbox
          .stub(queue, 'client')
          .get(() => Promise.resolve(mockClusterClient));

        const workers = await queue.getWorkers();

        // Should return 3 workers from node2 (the one with most connections)
        expect(workers).toHaveLength(3);
      });

      it('should return empty array when no matching workers found on any node', async () => {
        const clientListNode1 = buildClientList([
          buildClientLine(
            'id=1',
            'addr=127.0.0.1:6379',
            'name=other-queue',
            'age=10',
          ),
        ]);
        const clientListNode2 = buildClientList([
          buildClientLine(
            'id=2',
            'addr=127.0.0.1:6380',
            'name=another-queue',
            'age=10',
          ),
        ]);

        const mockNode1 = {
          client: sinon.stub().resolves(clientListNode1),
        };
        const mockNode2 = {
          client: sinon.stub().resolves(clientListNode2),
        };

        const mockClusterClient = {
          isCluster: true,
          nodes: sinon.stub().returns([mockNode1, mockNode2]),
        };

        sandbox
          .stub(queue, 'client')
          .get(() => Promise.resolve(mockClusterClient));

        const workers = await queue.getWorkers();

        expect(workers).toHaveLength(0);
      });
    });

    describe('when client is not a cluster', () => {
      it('should fetch client list from single node as before', async () => {
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

        const workers = await queue.getWorkers();
        expect(workers).toHaveLength(1);
        expect(workers[0]).toHaveProperty('name', queueName);

        await worker.close();
      });
    });
  });

  describe('getQueueEvents on cluster', () => {
    it('should fetch queue events from all cluster nodes and return from node with most matches', async () => {
      const clientName = getClientName(queueName);
      const clientListNode1 = buildClientList([
        buildClientLine(
          'id=1',
          'addr=127.0.0.1:6379',
          `name=${clientName}:qe`,
          'age=10',
        ),
      ]);
      const clientListNode2 = buildClientList([
        buildClientLine(
          'id=2',
          'addr=127.0.0.1:6380',
          `name=${clientName}:qe`,
          'age=10',
        ),
        buildClientLine(
          'id=3',
          'addr=127.0.0.1:6380',
          `name=${clientName}:qe`,
          'age=5',
        ),
      ]);

      const mockNode1 = {
        client: sinon.stub().resolves(clientListNode1),
      };
      const mockNode2 = {
        client: sinon.stub().resolves(clientListNode2),
      };

      const mockClusterClient = {
        isCluster: true,
        nodes: sinon.stub().returns([mockNode1, mockNode2]),
      };

      sandbox
        .stub(queue, 'client')
        .get(() => Promise.resolve(mockClusterClient));

      const queueEvents = await queue.getQueueEvents();

      // Should return 2 queue events from node2 (the one with most connections)
      expect(queueEvents).toHaveLength(2);
    });
  });

  describe('getWorkersCount on cluster', () => {
    it('should return correct count from cluster', async () => {
      const clientName = getClientName(queueName);
      const clientListNode1 = buildClientList([
        buildClientLine(
          'id=1',
          'addr=127.0.0.1:6379',
          `name=${clientName}:w:w1`,
          'age=10',
        ),
      ]);
      const clientListNode2 = buildClientList([
        buildClientLine(
          'id=2',
          'addr=127.0.0.1:6380',
          `name=${clientName}:w:w1`,
          'age=10',
        ),
        buildClientLine(
          'id=3',
          'addr=127.0.0.1:6380',
          `name=${clientName}:w:w2`,
          'age=5',
        ),
      ]);

      const mockNode1 = {
        client: sinon.stub().resolves(clientListNode1),
      };
      const mockNode2 = {
        client: sinon.stub().resolves(clientListNode2),
      };

      const mockClusterClient = {
        isCluster: true,
        nodes: sinon.stub().returns([mockNode1, mockNode2]),
      };

      sandbox
        .stub(queue, 'client')
        .get(() => Promise.resolve(mockClusterClient));

      const workersCount = await queue.getWorkersCount();

      // Should return 2 (from node2 which has the most workers)
      expect(workersCount).toBe(2);
    });
  });

  describe('edge cases', () => {
    describe('when cluster has only one node', () => {
      it('should return workers from that single node', async () => {
        const clientName = getClientName(queueName);
        const clientListNode1 = buildClientList([
          buildClientLine(
            'id=1',
            'addr=127.0.0.1:6379',
            `name=${clientName}:w:worker1`,
            'age=10',
          ),
          buildClientLine(
            'id=2',
            'addr=127.0.0.1:6379',
            `name=${clientName}:w:worker2`,
            'age=5',
          ),
        ]);

        const mockNode1 = {
          client: sinon.stub().resolves(clientListNode1),
        };

        const mockClusterClient = {
          isCluster: true,
          nodes: sinon.stub().returns([mockNode1]),
        };

        sandbox
          .stub(queue, 'client')
          .get(() => Promise.resolve(mockClusterClient));

        const workers = await queue.getWorkers();

        expect(workers).toHaveLength(2);
      });
    });

    describe('when all nodes have equal number of matching workers', () => {
      it('should return workers from the first node with maximum count', async () => {
        const clientName = getClientName(queueName);
        const clientListNode1 = buildClientList([
          buildClientLine(
            'id=1',
            'addr=127.0.0.1:6379',
            `name=${clientName}:w:worker1`,
            'age=10',
          ),
          buildClientLine(
            'id=2',
            'addr=127.0.0.1:6379',
            `name=${clientName}:w:worker2`,
            'age=5',
          ),
        ]);
        const clientListNode2 = buildClientList([
          buildClientLine(
            'id=3',
            'addr=127.0.0.1:6380',
            `name=${clientName}:w:worker3`,
            'age=10',
          ),
          buildClientLine(
            'id=4',
            'addr=127.0.0.1:6380',
            `name=${clientName}:w:worker4`,
            'age=5',
          ),
        ]);

        const mockNode1 = {
          client: sinon.stub().resolves(clientListNode1),
        };
        const mockNode2 = {
          client: sinon.stub().resolves(clientListNode2),
        };

        const mockClusterClient = {
          isCluster: true,
          nodes: sinon.stub().returns([mockNode1, mockNode2]),
        };

        sandbox
          .stub(queue, 'client')
          .get(() => Promise.resolve(mockClusterClient));

        const workers = await queue.getWorkers();

        // Should return 2 workers (from the first node with max count)
        expect(workers).toHaveLength(2);
      });
    });

    describe('when cluster has workers without names (unnamed workers)', () => {
      it('should include unnamed workers in the result', async () => {
        const clientName = getClientName(queueName);
        // Named worker
        const clientListNode1 = buildClientList([
          buildClientLine(
            'id=1',
            'addr=127.0.0.1:6379',
            `name=${clientName}:w:worker1`,
            'age=10',
          ),
        ]);
        // Both named and unnamed workers (unnamed worker matches clientName exactly)
        const clientListNode2 = buildClientList([
          buildClientLine(
            'id=2',
            'addr=127.0.0.1:6380',
            `name=${clientName}`,
            'age=10',
          ),
          buildClientLine(
            'id=3',
            'addr=127.0.0.1:6380',
            `name=${clientName}:w:worker2`,
            'age=5',
          ),
        ]);

        const mockNode1 = {
          client: sinon.stub().resolves(clientListNode1),
        };
        const mockNode2 = {
          client: sinon.stub().resolves(clientListNode2),
        };

        const mockClusterClient = {
          isCluster: true,
          nodes: sinon.stub().returns([mockNode1, mockNode2]),
        };

        sandbox
          .stub(queue, 'client')
          .get(() => Promise.resolve(mockClusterClient));

        const workers = await queue.getWorkers();

        // Should return 2 workers from node2 (1 unnamed + 1 named)
        expect(workers).toHaveLength(2);
      });
    });

    describe('when cluster nodes return empty client lists', () => {
      it('should return empty array', async () => {
        const mockNode1 = {
          client: sinon.stub().resolves(''),
        };
        const mockNode2 = {
          client: sinon.stub().resolves(''),
        };

        const mockClusterClient = {
          isCluster: true,
          nodes: sinon.stub().returns([mockNode1, mockNode2]),
        };

        sandbox
          .stub(queue, 'client')
          .get(() => Promise.resolve(mockClusterClient));

        const workers = await queue.getWorkers();

        expect(workers).toHaveLength(0);
      });
    });
  });
});

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
    queueName = `{test-cluster-${v4()}}`;
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
    queueName = `{test-cluster-auth-${v4()}}`;
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
