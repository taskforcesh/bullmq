import { AddressInfo, createServer } from 'net';
import { afterEach, describe, expect, it } from 'vitest';

import { Worker } from '../src/classes';
import {
  getBlockingRedisConnection,
  getRedisConnection,
} from './utils/get-redis-client';

describe('Worker close with unreachable Redis', () => {
  const workers: Worker[] = [];

  afterEach(async () => {
    await Promise.allSettled(
      workers.flatMap(worker => {
        const connection = getRedisConnection(worker);
        const blockingConnection = getBlockingRedisConnection(worker);

        return [connection.close(true), blockingConnection.close(true)];
      }),
    );
    workers.length = 0;
  });

  async function getUnusedPort(): Promise<number> {
    const server = createServer();

    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        server.close(error => (error ? reject(error) : resolve(port)));
      });
    });
  }

  async function createWorkerWithUnreachableRedis(): Promise<Worker> {
    const port = await getUnusedPort();
    const worker = new Worker('test-unreachable-redis', async () => {}, {
      connection: {
        host: '127.0.0.1',
        port,
        maxRetriesPerRequest: 0,
      },
    });
    worker.on('error', () => {});
    workers.push(worker);

    return worker;
  }

  async function expectToCloseWithin(
    worker: Worker,
    force = false,
  ): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        worker.close(force),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Worker.close() timed out')),
            2000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  it.each([
    { force: false, label: 'gracefully' },
    { force: true, label: 'forcefully' },
  ])('closes $label when Redis is unreachable', async ({ force }) => {
    const worker = await createWorkerWithUnreachableRedis();

    await new Promise(resolve => setTimeout(resolve, 300));
    await expectToCloseWithin(worker, force);

    expect(getRedisConnection(worker).status).toBe('closed');
    expect(getBlockingRedisConnection(worker).status).toBe('closed');
    if (!force) {
      expect(worker.isRunning()).toBe(false);
    }
  });

  it('closes idempotently before the initial connection', async () => {
    const worker = await createWorkerWithUnreachableRedis();

    await Promise.all([
      expectToCloseWithin(worker),
      expectToCloseWithin(worker),
    ]);

    expect(getRedisConnection(worker).status).toBe('closed');
    expect(getBlockingRedisConnection(worker).status).toBe('closed');
  });
});
