import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Queue, QueueEvents, Worker } from '../src/classes';
import { ChildPool } from '../src/classes/child-pool';
import { IRedisClient } from '../src/interfaces';
import { randomUUID } from '../src/utils';
import { cleanupQueue } from './utils/cleanup-queue';
import { createTestConnection } from './utils/connection-factory';

describe.each([false, true])(
  'Sandboxed worker idle timeout (useWorkerThreads: %s)',
  useWorkerThreads => {
    let worker: Worker;
    let queue: Queue;
    let events: QueueEvents;
    let connection: IRedisClient;

    afterEach(async () => {
      await worker?.close();
      await events?.close();
      await queue?.close();
      if (queue) {
        await cleanupQueue(queue.name);
      }
      await connection?.quit();
    });

    it('finishes active jobs and processes a later job in a fresh sandbox', async () => {
      connection = createTestConnection();
      const queueName = `test-${randomUUID()}`;
      const processor = join(__dirname, 'fixtures/fixture_processor_idle.js');
      queue = new Queue(queueName, { connection });
      events = new QueueEvents(queueName, { connection });
      worker = new Worker(queueName, processor, {
        connection,
        useWorkerThreads,
        sandboxedProcessorIdleTimeout: 50,
      });

      await events.waitUntilReady();
      const first = await queue.add('first', { delay: 200, value: 'first' });
      const firstResult = await first.waitUntilFinished(events, 5000);
      expect(firstResult.value).toBe('first');
      const pool: ChildPool = worker['childPool'];
      await vi.waitFor(() => expect(pool.getAllFree()).toHaveLength(0));

      const second = await queue.add('second', { delay: 200, value: 'second' });
      const secondResult = await second.waitUntilFinished(events, 5000);
      expect(secondResult.value).toBe('second');
      expect(secondResult.instanceId).not.toBe(firstResult.instanceId);
    });
  },
);
