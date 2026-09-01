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

import { Queue, Worker } from '../src/classes';
import { IRedisClient } from '../src/interfaces';
import { delay, randomUUID, removeAllQueueData } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';

describe('workers (ioredis-only)', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queueName: string;
  let connection: IRedisClient;

  beforeAll(async () => {
    connection = createTestConnection();
  });

  beforeEach(async () => {
    queueName = `test-${randomUUID()}`;
  });

  afterEach(async () => {
    await removeAllQueueData(createTestConnection(), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  describe('when the blocking connection is parked in "reconnecting" (#4585)', () => {
    it('recovers and keeps processing jobs after a Redis outage longer than drainDelay', async () => {
      const queue = new Queue(queueName, { connection, prefix });
      await queue.waitUntilReady();

      let processed = 0;
      const worker = new Worker(
        queueName,
        async () => {
          processed++;
        },
        { connection, prefix, drainDelay: 1 },
      );
      worker.on('error', () => {});
      await worker.waitUntilReady();

      try {
        await queue.add('before', {});
        await delay(1500);
        expect(processed).toBe(1);

        const backend = worker.getBackend() as any;
        const bclient = (await backend.blockingClient) as any;
        bclient.options.retryStrategy = () => 2500;
        bclient.stream.destroy(new Error('simulated redis outage'));

        await delay(5000);
        expect(bclient.status).toBe('ready');

        await queue.add('after', {});
        await delay(4000);
        expect(processed).toBe(2);
      } finally {
        await worker.close();
        await queue.close();
      }
    }, 30000);
  });

  describe('when a healthy blocking connection is torn down by the watchdog (#4585 ready-path race)', () => {
    it('recovers and keeps processing jobs (real ioredis)', async () => {
      // End-to-end regression for the second #4585 race (reported on 6.0.11).
      //
      // Here the connection is healthy ("ready") when the watchdog fires — e.g.
      // ioredis dropped briefly and self-healed before the deadline — but the
      // blocking command silently never settles (ioredis re-sends interrupted
      // blocking commands under `maxRetriesPerRequest: null`). The watchdog then
      // tears the *live* connection down; since ioredis closes the socket
      // asynchronously, a reconnect() issued in the same tick observed the stale
      // "ready" status, no-op'd, and the pending close then killed the
      // connection for good — parking the worker. We reproduce the "stuck
      // blocking command on a ready connection" with a hanging bzpopmin stub.
      const sandbox = sinon.createSandbox();
      const queue = new Queue(queueName, { connection, prefix });
      await queue.waitUntilReady();

      let processed = 0;
      const worker = new Worker(
        queueName,
        async () => {
          processed++;
        },
        { connection, prefix, drainDelay: 1 },
      );
      worker.on('error', () => {});
      await worker.waitUntilReady();

      try {
        await queue.add('before', {});
        await delay(1500);
        expect(processed).toBe(1);

        // Make the blocking command hang while the connection stays "ready", so
        // the watchdog fires against a live connection (drainDelay 1s → ~2s).
        const backend = worker.getBackend() as any;
        const bclient = (await backend.blockingClient) as any;
        const stub = sandbox
          .stub(bclient, 'bzpopmin')
          .returns(new Promise(() => {}) as any);

        // Let one watchdog cycle tear down and reconnect the connection.
        await delay(3500);
        stub.restore();

        // The blocking connection must be healthy again, not killed by a raced
        // reconnect.
        expect(bclient.status).toBe('ready');

        // A job added afterwards must be processed (stuck at 1 with the bug).
        await queue.add('after', {});
        await delay(4000);
        expect(processed).toBe(2);
      } finally {
        sandbox.restore();
        await worker.close();
        await queue.close();
      }
    }, 30000);
  });
});
