import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { IQueueBackend } from '../src';
import { workerRegistryTestHarness } from './utils/worker-registry';

/**
 * Worker registry tests. Backend-agnostic: they run against Redis (with every
 * client adapter) and PostgreSQL (vitest.postgres.config.ts), so the Lua
 * scripts and SQL functions are held to exactly the same behaviour.
 */
const ctx = workerRegistryTestHarness('registry');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const lease = 30_000;

describe(`Worker registry (${ctx.backend})`, () => {
  beforeAll(() => ctx.setup());
  afterAll(() => ctx.teardown());

  const backends: IQueueBackend[] = [];
  const queueNames: string[] = [];

  const newQueueName = () => {
    const queueName = `t-${randomUUID().slice(0, 13)}`;
    queueNames.push(queueName);
    return queueName;
  };
  const newBackend = async (queueName: string) => {
    const backend = ctx.createBackend(queueName);
    backends.push(backend);
    await backend.waitUntilReady();
    return backend;
  };

  const ids = async (backend: IQueueBackend) =>
    (await backend.getWorkerRegistrations()).map(worker => worker.id);

  afterEach(async () => {
    await Promise.all(backends.splice(0).map(backend => backend.close()));
    await Promise.all(queueNames.splice(0).map(name => ctx.cleanup(name)));
  });

  describe('backend contract', () => {
    it('lists the live Workers of a queue with their info', async () => {
      const backend = await newBackend(newQueueName());
      const other = await newBackend(newQueueName());
      const before = Date.now();
      await backend.registerWorker('w1', lease, {
        name: 'mailer',
        host: 'web-1',
        pid: 1234,
        version: '6.0.0',
      });
      await backend.registerWorker('w2', lease);
      await other.registerWorker('w3', lease);

      const workers = await backend.getWorkerRegistrations();
      expect(workers.map(worker => worker.id)).toEqual(['w1', 'w2']);
      expect(workers[0].info).toEqual({
        name: 'mailer',
        host: 'web-1',
        pid: 1234,
        version: '6.0.0',
      });
      expect(workers[1].info).toEqual({});

      // Times are the datastore server's epoch milliseconds.
      const [w1] = workers;
      expect(w1.registeredAt).toBeGreaterThanOrEqual(before - 5000);
      expect(w1.leaseUntil - w1.registeredAt).toBeGreaterThanOrEqual(lease - 5);
      expect(w1.leaseUntil - w1.registeredAt).toBeLessThanOrEqual(lease + 5);
      // Registering counts as the first heartbeat.
      expect(w1.lastHeartbeat).toBeGreaterThanOrEqual(w1.registeredAt);

      expect(await ids(other)).toEqual(['w3']);
    });

    it('hides a Worker whose lease expired until it is swept', async () => {
      const backend = await newBackend(newQueueName());
      await backend.registerWorker('short', 50);
      await backend.registerWorker('long', lease);
      await delay(100);

      expect(await ids(backend)).toEqual(['long']);
      expect(await backend.sweepWorkers(10)).toEqual(['short']);
    });

    it('refreshing a live Worker keeps its registration time', async () => {
      const backend = await newBackend(newQueueName());
      await backend.registerWorker('w1', lease, { name: 'a' });
      const [first] = await backend.getWorkerRegistrations();
      await delay(20);
      await backend.registerWorker('w1', lease, { name: 'b' });
      const [second] = await backend.getWorkerRegistrations();

      expect(second.registeredAt).toBe(first.registeredAt);
      expect(second.info).toEqual({ name: 'b' });
    });

    it('re-registering an expired id starts a fresh registration', async () => {
      const backend = await newBackend(newQueueName());
      await backend.registerWorker('w1', 50);
      const before = Date.now();
      await delay(100);
      await backend.registerWorker('w1', lease);
      const [worker] = await backend.getWorkerRegistrations();

      expect(worker.registeredAt).toBeGreaterThanOrEqual(before);
    });

    it("heartbeat renews a live Worker's lease", async () => {
      const backend = await newBackend(newQueueName());
      await backend.registerWorker('w1', 300);
      await delay(100);
      const [before] = await backend.getWorkerRegistrations();

      expect(await backend.heartbeatWorker('w1', lease)).toBe(true);
      const [after] = await backend.getWorkerRegistrations();
      expect(after.lastHeartbeat).toBeGreaterThan(before.lastHeartbeat!);

      // Renewed well past the original 300 ms lease.
      await delay(400);
      expect(await ids(backend)).toEqual(['w1']);
    });

    it('heartbeat returns false when the Worker must register again', async () => {
      const backend = await newBackend(newQueueName());
      const other = await newBackend(newQueueName());
      await backend.registerWorker('expired', 50);
      await other.registerWorker('other-queue', lease);
      await delay(100);

      expect(await backend.heartbeatWorker('expired', lease)).toBe(false);
      expect(await backend.heartbeatWorker('unknown', lease)).toBe(false);
      // A Worker of another queue is renewed there, not here.
      expect(await backend.heartbeatWorker('other-queue', lease)).toBe(false);
      expect(await other.heartbeatWorker('other-queue', lease)).toBe(true);
    });

    it('unregister removes the Worker and leaves nothing behind', async () => {
      const queueName = newQueueName();
      const backend = await newBackend(queueName);
      await backend.registerWorker('w1', lease);

      expect(await backend.unregisterWorker('w1')).toBe(true);
      expect(await backend.unregisterWorker('w1')).toBe(false);
      expect(await ids(backend)).toEqual([]);
      expect(await ctx.leftovers(queueName)).toEqual([]);
    });

    it('the same id on two queues is two registrations', async () => {
      const backend = await newBackend(newQueueName());
      const other = await newBackend(newQueueName());
      await backend.registerWorker('w1', lease, { name: 'a' });
      await other.registerWorker('w1', lease, { name: 'b' });

      expect((await backend.getWorkerRegistrations())[0].info).toEqual({
        name: 'a',
      });
      expect((await other.getWorkerRegistrations())[0].info).toEqual({
        name: 'b',
      });
    });

    it('sweep removes a bounded number of expired Workers', async () => {
      const backend = await newBackend(newQueueName());
      for (const id of ['old-a', 'old-b', 'old-c']) {
        await backend.registerWorker(id, 50);
      }
      await backend.registerWorker('live', lease);
      await delay(100);

      const first = await backend.sweepWorkers(2);
      expect(first).toHaveLength(2);
      const rest = await backend.sweepWorkers(10);
      expect([...first, ...rest].sort()).toEqual(['old-a', 'old-b', 'old-c']);
      expect(await backend.sweepWorkers(10)).toEqual([]);
      expect(await ids(backend)).toEqual(['live']);
    });

    it('leaves nothing behind once every Worker expired', async () => {
      const queueName = newQueueName();
      const backend = await newBackend(queueName);
      await backend.registerWorker('w1', 50);
      await delay(100);
      if (!ctx.selfExpiring) {
        await backend.sweepWorkers(100);
      }

      expect(await ctx.leftovers(queueName)).toEqual([]);
    });

    it('rejects invalid ids', async () => {
      const queueName = newQueueName();
      const backend = await newBackend(queueName);
      for (const id of ['', 'has space', 'has:colon', 'x'.repeat(65)]) {
        await expect(backend.registerWorker(id, lease)).rejects.toThrow(
          'Invalid worker id',
        );
      }
      expect(await ctx.leftovers(queueName)).toEqual([]);
    });
  });
});
