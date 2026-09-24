import { ChildProcess, fork } from 'child_process';
import * as path from 'path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Queue, Worker } from '../src/classes';
import { delay, randomUUID } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';
import { cleanupQueue } from './utils/cleanup-queue';

const waitFor = <T>(promise: Promise<T>, label: string, timeout = 3000) =>
  Promise.race([
    promise,
    delay(timeout).then(() => {
      throw new Error(`Timed out waiting for ${label}`);
    }),
  ]);

const stopChild = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = new Promise<void>(resolve =>
    child.once('exit', () => resolve()),
  );
  child.send({ shutdown: true });
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
  }, 2000);
  await exited;
  clearTimeout(timer);
};

describe('Queue-side job cancellation', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  const children = new Set<ChildProcess>();
  let connection: ReturnType<typeof createTestConnection>;
  let queue: Queue;
  let worker: Worker | undefined;
  let queueName: string;

  beforeAll(() => {
    connection = createTestConnection();
  });

  beforeEach(async () => {
    queueName = `test-${randomUUID()}`;
    queue = new Queue(queueName, { connection, prefix });
    await queue.waitUntilReady();
  });

  afterEach(async () => {
    try {
      await worker?.close(true);
    } finally {
      worker = undefined;
      await Promise.all([...children].map(stopChild));
      children.clear();
      await queue.close();
      await cleanupQueue(queueName);
    }
  });

  afterAll(async () => {
    await connection.quit();
  });

  it('publishes an accepted cancellation request to an active worker', async () => {
    let started!: () => void;
    const active = new Promise<void>(resolve => {
      started = resolve;
    });
    let cancelled = false;

    worker = new Worker(
      queueName,
      async (_job, _token, signal) => {
        started();
        return await new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            cancelled = true;
            reject(new Error('cancelled'));
          });
        });
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const job = await queue.add('test', { value: 1 });
    await waitFor(active, 'job activation');

    const result = await queue.cancelJob(job.id!, 'stop');

    expect(result).toBe('accepted');
    await vi.waitFor(() => expect(cancelled).toBe(true));
    await delay(20);
    expect(await job.getState()).toBe('failed');
  });

  it('cancels a job in a separate worker process', async () => {
    const child = fork(
      path.resolve(__dirname, './fixtures/queue_cancellation_worker.ts'),
      {
        execArgv: ['-r', 'ts-node/register'],
        env: {
          ...process.env,
          BULLMQ_TEST_QUEUE: queueName,
          BULLMQ_TEST_PREFIX: prefix,
          TS_NODE_COMPILER_OPTIONS: JSON.stringify({ module: 'commonjs' }),
          TS_NODE_TRANSPILE_ONLY: 'true',
        },
      },
    );
    children.add(child);
    const ready = new Promise<void>((resolve, reject) => {
      child.on('message', message => {
        if (message?.ready) {
          resolve();
        } else if (message?.error) {
          reject(new Error(message.error));
        }
      });
    });
    const cancellationObserved = new Promise<void>(resolve => {
      child.on('message', message => {
        if (message?.cancelled) {
          resolve();
        }
      });
    });

    await waitFor(ready, 'child worker readiness');
    const job = await queue.add('child', {});
    await vi.waitFor(async () => expect(await job.getState()).toBe('active'));
    expect(await queue.cancelJob(job.id!)).toBe('accepted');
    await waitFor(cancellationObserved, 'child cancellation');
    await vi.waitFor(async () => expect(await job.getState()).toBe('failed'));
  });

  it('returns the current state without changing non-active jobs', async () => {
    const waiting = await queue.add('waiting', {});
    expect(await queue.cancelJob(waiting.id!)).toBe('waiting');
    expect(await waiting.getState()).toBe('waiting');

    const delayed = await queue.add('delayed', {}, { delay: 10000 });
    expect(await queue.cancelJob(delayed.id!)).toBe('delayed');
    expect(await delayed.getState()).toBe('delayed');

    expect(await queue.cancelJob('missing')).toBe('unknown');
  });

  it('returns completed and failed for finished jobs', async () => {
    worker = new Worker(queueName, async () => 'done', { connection, prefix });
    await worker.waitUntilReady();

    const completed = await queue.add('completed', {});
    const completedEvent = new Promise<void>(resolve =>
      worker!.once('completed', () => resolve()),
    );
    await waitFor(completedEvent, 'completed job');
    expect(await queue.cancelJob(completed.id!)).toBe('completed');
    await worker.close();

    worker = new Worker(
      queueName,
      async () => {
        throw new Error('failed');
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();
    const failedEvent = new Promise<void>(resolve =>
      worker!.once('failed', () => resolve()),
    );
    const failed = await queue.add('failed', {});
    await waitFor(failedEvent, 'failed job');
    expect(await queue.cancelJob(failed.id!)).toBe('failed');
  });

  it('processes duplicate requests once and preserves the retry policy', async () => {
    let attempts = 0;
    let aborts = 0;
    let firstActive!: () => void;
    let secondActive!: () => void;
    const firstAttempt = new Promise<void>(resolve => (firstActive = resolve));
    const secondAttempt = new Promise<void>(
      resolve => (secondActive = resolve),
    );

    worker = new Worker(
      queueName,
      async (_job, _token, signal) => {
        attempts++;
        if (attempts === 1) {
          firstActive();
        } else {
          secondActive();
        }
        return await new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => {
            aborts++;
            reject(new Error('cancelled'));
          });
          if (attempts === 2) {
            resolve('done');
          }
        });
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    let failedEvents = 0;
    worker.on('failed', () => failedEvents++);
    const job = await queue.add('retry', {}, { attempts: 2 });
    await waitFor(firstAttempt, 'first attempt');
    expect(
      await Promise.all([
        queue.cancelJob(job.id!, 'stop'),
        queue.cancelJob(job.id!, 'stop'),
        queue.cancelJob(job.id!, 'stop'),
      ]),
    ).toEqual(['accepted', 'accepted', 'accepted']);
    await waitFor(secondAttempt, 'second attempt');
    await vi.waitFor(async () =>
      expect(await job.getState()).toBe('completed'),
    );

    expect(attempts).toBe(2);
    expect(aborts).toBe(1);
    expect(failedEvents).toBe(1);
    expect(await queue.cancelJob(job.id!)).toBe('completed');
  });

  it('emits one terminal event when cancellation races completion', async () => {
    let release!: () => void;
    worker = new Worker(
      queueName,
      async () =>
        await new Promise<void>(resolve => {
          release = resolve;
        }),
      { connection, prefix },
    );
    await worker.waitUntilReady();

    let terminalEvents = 0;
    const terminal = new Promise<string>(resolve => {
      worker!.on('completed', () => {
        terminalEvents++;
        resolve('completed');
      });
      worker!.on('failed', () => {
        terminalEvents++;
        resolve('failed');
      });
    });
    const job = await queue.add('race', {});
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    const result = await queue.cancelJob(job.id!);
    release();
    const outcome = await waitFor(terminal, 'terminal event');
    await delay(30);

    expect(['accepted', 'completed']).toContain(result);
    expect(['completed', 'failed']).toContain(outcome);
    expect(terminalEvents).toBe(1);
    expect(await job.getState()).toBe(outcome);
  });

  it('renews an unaffected job lock while cancelling another job', async () => {
    let releaseUnaffected!: () => void;
    let targetActive!: () => void;
    let unaffectedActive!: () => void;
    let targetFailed!: () => void;
    const targetStarted = new Promise<void>(
      resolve => (targetActive = resolve),
    );
    const unaffectedStarted = new Promise<void>(
      resolve => (unaffectedActive = resolve),
    );
    const failed = new Promise<void>(resolve => (targetFailed = resolve));
    const renewedJobIds = new Set<string>();

    worker = new Worker(
      queueName,
      async (job, _token, signal) => {
        if (job.data.kind === 'target') {
          targetActive();
          return await new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () =>
              reject(new Error('cancelled')),
            );
          });
        }
        unaffectedActive();
        return await new Promise(resolve => {
          releaseUnaffected = () => resolve('done');
        });
      },
      {
        connection,
        prefix,
        concurrency: 2,
        lockDuration: 500,
        lockRenewTime: 100,
      },
    );
    worker.on('locksRenewed', ({ jobIds }) => {
      jobIds.forEach(jobId => renewedJobIds.add(jobId));
    });
    worker.on('failed', () => targetFailed());
    await worker.waitUntilReady();

    const target = await queue.add('renewal', { kind: 'target' });
    await waitFor(targetStarted, 'target activation');
    const unaffected = await queue.add('renewal', { kind: 'unaffected' });
    await waitFor(unaffectedStarted, 'unaffected activation');
    expect(await queue.cancelJob(target.id!)).toBe('accepted');
    await waitFor(failed, 'target cancellation');

    await delay(250);
    releaseUnaffected();
    await vi.waitFor(async () =>
      expect(await unaffected.getState()).toBe('completed'),
    );
    expect(renewedJobIds).toContain(unaffected.id!);
  });

  it('closes the cancellation subscription and worker connections', async () => {
    const connectionCount = async () =>
      (await connection.clientList()).trim().split('\n').filter(Boolean).length;
    const baseline = await connectionCount();

    worker = new Worker(queueName, async () => 'done', { connection, prefix });
    await worker.waitUntilReady();
    await vi.waitFor(async () =>
      expect(await connectionCount()).toBeGreaterThan(baseline),
    );

    await worker.close(true);
    worker = undefined;
    await vi.waitFor(async () =>
      expect(await connectionCount()).toBeLessThanOrEqual(baseline),
    );
  });
});
