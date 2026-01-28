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
import { Queue, Worker } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

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
