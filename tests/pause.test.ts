import { default as IORedis } from '@sinianluoye/ioredis';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { v4 } from 'uuid';
import { Job, Queue, QueueEvents, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Pause', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let queueEvents: QueueEvents;

  let connection;
  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  it('should not process delayed jobs', async () => {
    let processed = false;

    const worker = new Worker(
      queueName,
      async () => {
        processed = true;
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    await queue.pause();
    await queue.add('test', {}, { delay: 300 });
    const counts = await queue.getJobCounts('waiting', 'delayed');

    expect(counts).toHaveProperty('waiting', 0);
    expect(counts).toHaveProperty('delayed', 1);

    await delay(500);
    if (processed) {
      throw new Error('should not process delayed jobs in paused queue.');
    }
    const counts2 = await queue.getJobCounts('waiting', 'paused', 'delayed');
    expect(counts2).toHaveProperty('waiting', 0);
    expect(counts2).toHaveProperty('paused', 1);
    expect(counts2).toHaveProperty('delayed', 0);

    await worker.close();
  });

  it('should pause a queue until resumed', async () => {
    let process;
    let isPaused = false;
    let counter = 2;
    const processPromise = new Promise<void>(resolve => {
      process = async (job: Job) => {
        expect(isPaused).toEqual(false);
        expect(job.data.foo).toBe('paused');
        counter--;
        if (counter === 0) {
          resolve();
        }
      };
    });

    const worker = new Worker(queueName, process, { connection, prefix });
    await worker.waitUntilReady();

    await queue.pause();
    isPaused = true;
    await queue.add('test', { foo: 'paused' });
    await queue.add('test', { foo: 'paused' });
    isPaused = false;
    await queue.resume();

    await processPromise;
    return worker.close();
  });

  it('should be able to pause a running queue and emit relevant events', async () => {
    let process;

    let isPaused = false,
      isResumed = true,
      first = true;

    const processPromise = new Promise<void>((resolve, reject) => {
      process = async (job: Job) => {
        try {
          expect(isPaused).toEqual(false);
          expect(job.data.foo).toBe('paused');

          if (first) {
            first = false;
            isPaused = true;
            return queue.pause();
          } else {
            expect(isResumed).toEqual(true);
            await queue.close();
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      };
    });

    const worker = new Worker(queueName, process, { connection, prefix });

    queueEvents.on('paused', async (args, eventId) => {
      isPaused = false;
      expect(args).toEqual({});
      expect(eventId).toBeTypeOf('string');
      await queue.resume();
    });

    queueEvents.on('resumed', (args, eventId) => {
      expect(args).toEqual({});
      expect(eventId).toBeTypeOf('string');
      isResumed = true;
    });

    await queue.add('test', { foo: 'paused' });
    await queue.add('test', { foo: 'paused' });

    await processPromise;

    await worker.close();
  });

  it('should pause the queue locally', async () => {
    // eslint-disable-next-line prefer-const
    let worker: Worker;
    let counter = 2;
    let process;
    const processPromise = new Promise<void>(resolve => {
      process = async () => {
        expect(worker.isPaused()).toEqual(false);
        counter--;
        if (counter === 0) {
          await queue.close();
          resolve();
        }
      };
    });

    worker = new Worker(queueName, process, { connection, prefix });
    await worker.waitUntilReady();

    await worker.pause();

    // Add the worker after the queue is in paused mode since the normal behavior is to pause
    // it after the current lock expires. This way, we can ensure there isn't a lock already
    // to test that pausing behavior works.

    await queue.add('test', { foo: 'paused' });
    await queue.add('test', { foo: 'paused' });

    expect(counter).toEqual(2);
    expect(worker.isPaused()).toEqual(true);

    await worker.resume();

    await processPromise;
    await worker.close();
  });

  it('should wait until active jobs are finished before resolving pause', async () => {
    let process;

    const startProcessing = new Promise<void>(resolve => {
      process = async () => {
        resolve();
        return delay(1000);
      };
    });

    const worker = new Worker(queueName, process, { connection, prefix });
    await worker.waitUntilReady();

    const jobs: Promise<Job | void>[] = [];
    for (let i = 0; i < 10; i++) {
      jobs.push(queue.add('test', i));
    }

    //
    // Add start processing so that we can test that pause waits for this job to be completed.
    //
    jobs.push(startProcessing);
    await Promise.all(jobs);
    await worker.pause();

    let active = await queue.getJobCountByTypes('active');
    expect(active).toEqual(0);
    expect(worker.isPaused()).toEqual(true);

    // One job from the 10 posted above will be processed, so we expect 9 jobs pending
    let paused = await queue.getJobCountByTypes('delayed', 'waiting');
    expect(paused).toEqual(9);

    await queue.add('test', {});

    active = await queue.getJobCountByTypes('active');
    expect(active).toEqual(0);

    paused = await queue.getJobCountByTypes('paused', 'waiting', 'delayed');
    expect(paused).toEqual(10);

    await worker.close();
  });

  it('should pause the queue locally when more than one worker is active', async () => {
    let process1, process2;

    const startProcessing1 = new Promise<void>(resolve => {
      process1 = async () => {
        resolve();
        return delay(200);
      };
    });

    const startProcessing2 = new Promise<void>(resolve => {
      process2 = async () => {
        resolve();
        return delay(200);
      };
    });

    const worker1 = new Worker(queueName, process1, { connection, prefix });
    await worker1.waitUntilReady();

    const worker2 = new Worker(queueName, process2, { connection, prefix });
    await worker2.waitUntilReady();

    await Promise.all([
      queue.add('test', 1),
      queue.add('test', 2),
      queue.add('test', 3),
      queue.add('test', 4),
    ]);

    await Promise.all([startProcessing1, startProcessing2]);
    await Promise.all([worker1.pause(), worker2.pause()]);

    const count = await queue.getJobCounts('active', 'waiting', 'completed');
    expect(count.active).toEqual(0);
    expect(count.waiting).toEqual(2);
    expect(count.completed).toEqual(2);

    return Promise.all([worker1.close(), worker2.close()]);
  });

  it('should wait for blocking job retrieval to complete before pausing locally', async () => {
    let process;

    const startProcessing = new Promise<void>(resolve => {
      process = async () => {
        resolve();
        return delay(200);
      };
    });

    const worker = new Worker(queueName, process, { connection, prefix });
    await worker.waitUntilReady();

    await queue.add('test', 1);
    await startProcessing;
    await worker.pause();
    await queue.add('test', 2);

    const count = await queue.getJobCounts('active', 'waiting', 'completed');
    expect(count.active).toEqual(0);
    expect(count.waiting).toEqual(1);
    expect(count.completed).toEqual(1);

    return worker.close();
  });

  it('pauses fast when queue is drained', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        await delay(50);
      },
      {
        connection,
        prefix,
      },
    );
    await worker.waitUntilReady();

    const waitDrainedEvent = new Promise<void>(resolve => {
      queueEvents.once('drained', async () => {
        const start = new Date().getTime();
        await queue.pause();

        const finish = new Date().getTime();
        expect(finish - start).toBeLessThan(1000);
        resolve();
      });
    });

    await queue.add('test', {});

    await waitDrainedEvent;
    await worker.close();
  });

  it('gets the right response from isPaused', async () => {
    await queue.pause();
    const isPausedQueuePaused = await queue.isPaused();
    expect(isPausedQueuePaused).toBe(true);

    await queue.resume();
    const isResumedQueuePaused = await queue.isPaused();
    expect(isResumedQueuePaused).toBe(false);
  });

  it('should pause and resume worker without error', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        await delay(100);
      },
      { connection, prefix },
    );

    await worker.waitUntilReady();
    await delay(10);
    await worker.pause();
    await delay(10);
    worker.resume();
    await delay(10);
    await worker.pause();
    await delay(10);

    return worker.close();
  }); // TODO: Add { timeout: 8000 } to the it() options

  describe('when backoff is 0', () => {
    it('moves job into paused queue', async () => {
      let worker: Worker;
      const processing = new Promise<void>(resolve => {
        worker = new Worker(
          queueName,
          async job => {
            await delay(10);
            if (job.attemptsMade == 0) {
              await queue.pause();
              throw new Error('Not yet!');
            }

            resolve();
          },
          {
            autorun: false,
            connection,
            prefix,
          },
        );
      });

      const waitingEvent = new Promise<void>((resolve, reject) => {
        queueEvents.on('waiting', async ({ prev }) => {
          try {
            if (prev) {
              expect(prev).toEqual('active');
              const count = await queue.getJobCountByTypes('paused');
              expect(count).toBe(1);
              await queue.resume();
              resolve();
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      await queue.add('test', { foo: 'bar' }, { attempts: 2, backoff: 0 });

      worker!.run();
      await waitingEvent;
      await processing;

      await worker!.close();
    });
  });
});
