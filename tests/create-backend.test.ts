import { describe, expect, it } from 'vitest';
import { createClient } from 'redis';
import { Queue, QueueEvents, Worker } from '../src/classes';
import { randomUUID } from '../src/utils';
import { createRedisBackend } from '../src/utils/create-backend';
import { cleanupQueue } from './utils/cleanup-queue';
import { createTestConnection } from './utils/connection-factory';

describe('Redis backend connection ownership', () => {
  it.each([
    { blocking: false, force: false },
    { blocking: false, force: true },
    { blocking: true, force: false },
    { blocking: true, force: true },
  ])(
    'closes only owned clients (blocking: $blocking, force: $force)',
    async ({ blocking, force }) => {
      const connection = createTestConnection();
      const opts = {
        connection,
        prefix: process.env.BULLMQ_TEST_PREFIX || 'bull',
      };
      const backend = createRedisBackend(`test-${randomUUID()}`, opts, {
        blocking,
      });
      try {
        await backend.waitUntilReady();
        const client = await backend.connection.client;
        if (blocking) {
          expect(client).not.toBe(connection);
        } else {
          expect(client).toBe(connection);
        }

        await backend.close(force);

        expect(client.status).toBe(blocking ? 'end' : 'ready');
        expect(await connection.info()).toContain('redis_version');
      } finally {
        if (blocking) {
          await backend.disconnect();
        }
        await backend.close(true);
        await connection.quit();
      }
    },
  );
});

describe('Redis backend duplication of raw node-redis clients', () => {
  it('adapts dedicated blocking connections with the native driver', async () => {
    const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
    const queueName = `test-${randomUUID()}`;
    const raw = createClient({
      url: `redis://${process.env.REDIS_HOST || 'localhost'}:${
        process.env.REDIS_PORT || 6379
      }`,
    });
    await raw.connect();
    const errorListeners = raw.listenerCount('error');
    const queue = new Queue(queueName, {
      connection: createTestConnection(),
      prefix,
    });
    const events = new QueueEvents(queueName, { connection: raw, prefix });
    let worker: Worker | undefined;
    try {
      await events.waitUntilReady();
      expect(raw.listenerCount('error')).toBe(errorListeners);

      worker = new Worker(queueName, async () => 'done', {
        connection: raw,
        prefix,
      });
      await worker.waitUntilReady();
      for (const client of [
        await events.getBackend().connection.client,
        await worker.getBackend().blockingConnection!.client,
      ]) {
        expect(client).not.toBe(raw);
        expect((client as any).__bullmq_iredis).toBeUndefined();
      }
      expect(await queue.getWorkersCount()).toBe(1);

      const job = await queue.add('test', {});
      await expect(job.waitUntilFinished(events, 5000)).resolves.toBe('done');
    } finally {
      await worker?.close();
      await events.close();
      await queue.close();
      await cleanupQueue(queueName, prefix);
      await raw.quit();
    }
  });
});
