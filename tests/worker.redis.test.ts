/**
 * Redis-only tests for `Worker`.
 *
 * These exercise Redis-specific internals (raw event-stream length via `xlen`,
 * etc.) that have no backend-agnostic equivalent. They live in a dedicated
 * `*.redis.test.ts` suite excluded from the cross-backend runs.
 */
import {
  getRedisClient,
  getRedisVersion,
  getBlockingRedisClient,
} from './utils/get-redis-client';
import * as sinon from 'sinon';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import {
  Queue,
  QueueEvents,
  Job,
  Worker,
  WaitingChildrenError,
} from '../src/classes';
import { IRedisClient } from '../src/interfaces';
import {
  delay,
  isRedisVersionLowerThan,
  randomUUID,
  removeAllQueueData,
} from '../src/utils';
import { createTestConnection } from './utils/connection-factory';

const NoopProc = () => Promise.resolve();

describe('workers (redis-only)', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  let connection: IRedisClient;
  beforeAll(async () => {
    connection = createTestConnection();
  });

  beforeEach(async () => {
    queueName = `test-${randomUUID()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(createTestConnection(), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  it('should cap progress events', async () => {
    let processor;

    const maxEvents = 10;
    const numUpdateProgress = 500;

    const trimmedEventsQueue = new Queue(queueName, {
      connection,
      prefix,
      streams: { events: { maxLen: maxEvents } },
    });

    const job = await trimmedEventsQueue.add('test', { foo: 'bar' });
    expect(job.id).toBeTruthy();
    expect(job.data.foo).toEqual('bar');

    const processing = new Promise<void>((resolve, reject) => {
      processor = async (job: Job) => {
        try {
          expect(job.data.foo).toBe('bar');

          for (let i = 0; i < numUpdateProgress; i++) {
            await job.updateProgress(42);
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      };
    });

    const worker = new Worker(queueName, processor, { connection, prefix });
    await worker.waitUntilReady();

    await processing;

    const eventsLength = await (
      await getRedisClient(trimmedEventsQueue)
    ).xlen(trimmedEventsQueue.keys.events);

    expect(eventsLength).toBeLessThan(numUpdateProgress + 10);
    expect(eventsLength).toBeGreaterThanOrEqual(maxEvents);

    await worker.close();
    await trimmedEventsQueue.close();
  });

  it('do not call moveToActive more than concurrency factor + 1', async () => {
    const numJobs = 57;
    const concurrency = 13;
    let completedJobs = 0;
    const worker = new Worker(
      queueName,
      async job => {
        expect(job.data.foo).toBe('bar');
        await delay(250);
      },
      { connection, prefix, concurrency },
    );
    await worker.waitUntilReady();

    // Add spy to worker.moveToActive
    const spy = sinon.spy(worker as any, 'moveToActive');
    const bclientSpy = sinon.spy(
      await getBlockingRedisClient(worker),
      'bzpopmin',
    );

    const jobsData: { name: string; data: any }[] = [];
    for (let j = 0; j < numJobs; j++) {
      jobsData.push({
        name: 'test',
        data: { foo: 'bar' },
      });
    }

    await queue.addBulk(jobsData);

    expect(bclientSpy.callCount).toBeGreaterThanOrEqual(0);
    expect(bclientSpy.callCount).toBeLessThanOrEqual(1);

    await new Promise<void>(resolve => {
      worker.on('completed', () => {
        completedJobs++;
        if (completedJobs == numJobs) {
          resolve();
        }
      });
    });

    // Check moveToActive was called only concurrency times
    expect(spy.callCount).toBe(concurrency + 1);
    expect(bclientSpy.callCount).toBe(2);

    await worker.close();
  });

  it('do not call moveToActive more than number of jobs + 2', async () => {
    const numJobs = 50;
    let completedJobs = 0;

    const jobs: Promise<Job>[] = [];
    for (let i = 0; i < numJobs; i++) {
      jobs.push(queue.add('test', { foo: 'bar' }));
    }

    await Promise.all(jobs);

    const worker = new Worker(
      queueName,
      async job => {
        expect(job.data.foo).toBe('bar');
        await delay(250);
      },
      { connection, prefix, concurrency: 100 },
    );

    // Add spy to worker.moveToActive
    const spy = sinon.spy(worker as any, 'moveToActive');
    const bclientSpy = sinon.spy(
      await getBlockingRedisClient(worker),
      'bzpopmin',
    );
    await worker.waitUntilReady();

    expect(bclientSpy.callCount).toBe(0);

    await new Promise<void>(resolve => {
      worker.on('completed', () => {
        completedJobs++;
        if (completedJobs == numJobs) {
          resolve();
        }
      });
    });

    expect(completedJobs).toBe(numJobs);
    expect(bclientSpy.callCount).toBe(2);

    // Check moveToActive was called numJobs + 2 times
    expect(spy.callCount).toBe(numJobs + 2);

    await worker.close();
  });

  describe('when 0.002 is used as blocktimeout', () => {
    it('should not block forever', async () => {
      const worker = new Worker(queueName, NoopProc, {
        connection,
        prefix,
      });
      await worker.waitUntilReady();
      const client = await getRedisClient(worker);
      if (isRedisVersionLowerThan(getRedisVersion(worker), '7.0.8', 'redis')) {
        await client.bzpopmin(`key`, 0.002);
      } else {
        await client.bzpopmin(`key`, 0.001);
      }

      expect(true).toBe(true);
      await worker.close();
    });
  });

  it('should not leave orphaned job data when limit is less than removable jobs', async () => {
    const limit = 2;
    const age = 1; // 1 second
    const totalJobs = 10;

    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
      removeOnComplete: { age, limit },
      concurrency: 1,
    });
    await worker.waitUntilReady();

    const initialJobIds: string[] = [];
    for (let i = 0; i < totalJobs; i++) {
      const job = await queue.add('test', { phase: 1, i });
      initialJobIds.push(job.id!);
    }

    await new Promise<void>(resolve => {
      const checkCompleted = async () => {
        const counts = await queue.getJobCounts('completed');
        if (counts.completed >= totalJobs) {
          resolve();
        } else {
          setTimeout(checkCompleted, 50);
        }
      };
      checkCompleted();
    });

    await delay(age * 1000 + 500);

    const triggerJob = await queue.add('test', { phase: 2, trigger: true });

    await new Promise<void>(resolve => {
      const checkCompleted = async () => {
        const job = await queue.getJob(triggerJob.id!);
        if (job?.finishedOn) {
          resolve();
        } else {
          setTimeout(checkCompleted, 50);
        }
      };
      checkCompleted();
    });

    await delay(200);

    const client = await getRedisClient(queue);

    const existingJobKeys = await Promise.all(
      initialJobIds.map(async jobId => {
        const exists = await client.exists(`${prefix}:${queue.name}:${jobId}`);
        return exists;
      }),
    );
    const orphanedCount = existingJobKeys.reduce(
      (sum, exists) => sum + exists,
      0,
    );

    const initialJobsInSet = await Promise.all(
      initialJobIds.map(async jobId => {
        const score = await client.zscore(
          `${prefix}:${queue.name}:completed`,
          jobId,
        );
        return score !== null ? 1 : 0;
      }),
    );
    const initialJobsInSetCount = initialJobsInSet.reduce(
      (sum, v) => sum + v,
      0,
    );

    expect(orphanedCount).toBe(initialJobsInSetCount);

    await worker.close();
  });

  describe('when prioritized jobs are added', () => {
    describe('when priority counter is having a high number', () => {
      it('should process jobs by priority', async () => {
        let processor;

        const numJobsPerPriority = 6;

        const jobs = Array.from(Array(18).keys()).map(index => ({
          name: 'test',
          data: { p: (index % 3) + 1 },
          opts: {
            priority: (index % 3) + 1,
          },
        }));
        await queue.addBulk(jobs);
        const client = await getRedisClient(queue);
        await client.incrby(`${prefix}:${queue.name}:pc`, 2147483648);
        await queue.addBulk(jobs);

        let currentPriority = 1;
        let counter = 0;
        let total = 0;
        const countersPerPriority = {};

        const processing = new Promise<void>((resolve, reject) => {
          processor = async (job: Job) => {
            await delay(10);
            try {
              if (countersPerPriority[job.data.p]) {
                expect(countersPerPriority[job.data.p]).toBeLessThan(+job.id!);
              }

              countersPerPriority[job.data.p] = +job.id!;
              expect(job.id).toBeTruthy();
              expect(job.data.p).toEqual(currentPriority);
            } catch (err) {
              reject(err);
            }

            total++;
            if (++counter === numJobsPerPriority * 2) {
              currentPriority++;
              counter = 0;

              if (currentPriority === 4 && total === numJobsPerPriority * 6) {
                resolve();
              }
            }
          };
        });

        const worker = new Worker(queueName, processor, { connection, prefix });
        await worker.waitUntilReady();

        await processing;

        await worker.close();
      });
    });
  });

  it('keeps locks for all the jobs that are processed concurrently', async () => {
    const concurrency = 57;

    const lockKey = (jobId: string) => `${prefix}:${queueName}:${jobId}:lock`;
    const client = await getRedisClient(queue);

    let worker: Worker;

    const processing = new Promise<void>((resolve, reject) => {
      let count = 0;
      worker = new Worker(
        queueName,
        async job => {
          try {
            const lock = await client.get(lockKey(job.id!));
            expect(lock).toBeTruthy();

            await delay(2000);

            const renewedLock = await client.get(lockKey(job.id!));
            expect(renewedLock).toEqual(lock);

            count++;

            if (count === concurrency) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        },
        { connection, prefix, lockDuration: 250, concurrency },
      );
    });

    await worker!.waitUntilReady();

    await Promise.all(
      Array.from({ length: concurrency }).map(() =>
        queue.add('test', { bar: 'baz' }),
      ),
    );

    await processing;

    await worker!.close();
  });

  it('emits error if lock is lost', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        return delay(1250);
      },
      {
        connection,
        prefix,
        lockDuration: 1000,
        lockRenewTime: 3000, // The lock will not be updated in time
      },
    );
    await worker.waitUntilReady();

    const job = await queue.add('test', { bar: 'baz' });

    const errorMessage = `Missing lock for job ${job.id}. moveToFinished`;
    const workerError = new Promise<void>((resolve, reject) => {
      worker.once('error', error => {
        try {
          expect(error.message).toBe(errorMessage);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await workerError;

    await worker.close();
  });

  it('emits error if lock is "stolen"', async function () {
    const connection = createTestConnection();

    const worker = new Worker(
      queueName,
      async job => {
        connection.set(`${prefix}:${queueName}:${job.id}:lock`, 'foo');
        return delay(2000);
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const job = await queue.add('test', { bar: 'baz' });

    const errorMessage = `Lock mismatch for job ${job.id}. Cmd moveToFinished from active`;
    const workerError = new Promise<void>((resolve, reject) => {
      worker.once('error', error => {
        try {
          expect(error.message).toBe(errorMessage);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await workerError;

    await worker.close();
    await connection.quit();
  });

  it('deletes token after moving jobs to delayed', async () => {
    const worker = new Worker(
      queueName,
      async job => {
        if (job.attemptsMade !== 2) {
          throw new Error('error');
        }
        return delay(100);
      },
      {
        connection,
        prefix,
        lockDuration: 10000,
        lockRenewTime: 3000, // The lock will not be updated
      },
    );
    await worker.waitUntilReady();

    const client = await getRedisClient(queue);

    const job = await queue.add(
      'test',
      { bar: 'baz' },
      { attempts: 3, backoff: 100 },
    );

    worker.on('failed', async () => {
      const token = await client.get(`${prefix}:${queueName}:${job.id}:lock`);
      expect(token).toBeNull();
    });

    const workerCompleted = new Promise<void>(resolve => {
      worker.once('completed', () => {
        resolve();
      });
    });

    await workerCompleted;

    const token = await client.get(`${prefix}:${queueName}:${job.id}:lock`);

    expect(token).toBeNull();

    await worker.close();
  });

  it('should clear job from stalled set when job completed', async () => {
    const client = await getRedisClient(queue);
    const worker = new Worker(
      queueName,
      async () => {
        return delay(100);
      },
      { connection, prefix, stalledInterval: 10 },
    );
    await worker.waitUntilReady();

    await queue.add('test', { foo: 'bar' });

    const allStalled = new Promise<void>(resolve => {
      worker.once('completed', async () => {
        const stalled = await client.scard(`${prefix}:${queueName}:stalled`);
        expect(stalled).toBe(0);
        resolve();
      });
    });

    await allStalled;

    await worker.close();
  });

  // These step-job tests are Redis-coupled: a child created at runtime sets its
  // parent queue to `${prefix}:${parentQueueName}`, which only matches the
  // qualified name on the Redis backend (PG's qualified name has no prefix).
  describe('when creating children at runtime', () => {
    it('should wait children as one step of the parent job', async () => {
      const parentQueueName = `parent-queue-${randomUUID()}`;
      const parentQueue = new Queue(parentQueueName, { connection, prefix });

      enum Step {
        Initial,
        Second,
        Third,
        Finish,
      }

      let waitingChildrenStepExecutions = 0;

      const worker = new Worker(
        parentQueueName,
        async (job, token) => {
          let step = job.data.step;
          while (step !== Step.Finish) {
            switch (step) {
              case Step.Initial: {
                await queue.add(
                  'child-1',
                  { foo: 'bar' },
                  { parent: { id: job.id!, queue: job.queueQualifiedName } },
                );
                await job.updateData({ step: Step.Second });
                step = Step.Second;
                break;
              }
              case Step.Second: {
                await queue.add(
                  'child-2',
                  { foo: 'bar' },
                  {
                    parent: {
                      id: job.id,
                      queue: `${prefix}:${parentQueueName}`,
                    },
                  },
                );
                await job.updateData({ step: Step.Third });
                step = Step.Third;
                break;
              }
              case Step.Third: {
                waitingChildrenStepExecutions++;
                const shouldWait = await job.moveToWaitingChildren(token);
                if (!shouldWait) {
                  await job.updateData({ step: Step.Finish });
                  step = Step.Finish;
                  return Step.Finish;
                } else {
                  throw new WaitingChildrenError();
                }
              }
              default: {
                throw new Error('invalid step');
              }
            }
          }
        },
        { connection, prefix },
      );
      const childrenWorker = new Worker(queueName, async () => delay(200), {
        connection,
        prefix,
      });
      await childrenWorker.waitUntilReady();
      await worker.waitUntilReady();

      await parentQueue.add(
        'test',
        { step: Step.Initial },
        { attempts: 3, backoff: 1000 },
      );

      await new Promise<void>((resolve, reject) => {
        worker.on('completed', job => {
          expect(job.returnvalue).toBe(Step.Finish);
          resolve();
        });
        worker.on('error', () => reject());
      });

      expect(waitingChildrenStepExecutions).toBe(2);
      await worker.close();
      await childrenWorker.close();
      await parentQueue.close();
      await removeAllQueueData(createTestConnection(), parentQueueName);
    });

    describe('when skip attempt option is provided as true', () => {
      it('should wait children as one step of the parent job whithout incrementing attemptMade', async () => {
        const parentQueueName = `parent-queue-${randomUUID()}`;
        const parentQueue = new Queue(parentQueueName, { connection, prefix });

        enum Step {
          Initial,
          Second,
          Third,
          Finish,
        }

        let waitingChildrenStepExecutions = 0;

        const worker = new Worker(
          parentQueueName,
          async (job, token) => {
            let step = job.data.step;
            while (step !== Step.Finish) {
              switch (step) {
                case Step.Initial: {
                  await queue.add(
                    'child-1',
                    { foo: 'bar' },
                    { parent: { id: job.id!, queue: job.queueQualifiedName } },
                  );
                  await job.updateData({ step: Step.Second });
                  step = Step.Second;
                  break;
                }
                case Step.Second: {
                  await queue.add(
                    'child-2',
                    { foo: 'bar' },
                    {
                      parent: {
                        id: job.id!,
                        queue: `${prefix}:${parentQueueName}`,
                      },
                    },
                  );
                  await job.updateData({ step: Step.Third });
                  step = Step.Third;
                  break;
                }
                case Step.Third: {
                  waitingChildrenStepExecutions++;
                  const shouldWait = await job.moveToWaitingChildren(token!);
                  if (!shouldWait) {
                    await job.updateData({ step: Step.Finish });
                    step = Step.Finish;
                    return Step.Finish;
                  } else {
                    throw new WaitingChildrenError();
                  }
                }
                default: {
                  throw new Error('invalid step');
                }
              }
            }
          },
          { connection, prefix },
        );
        const childrenWorker = new Worker(queueName, async () => delay(200), {
          connection,
          prefix,
        });
        await childrenWorker.waitUntilReady();
        await worker.waitUntilReady();

        await parentQueue.add(
          'test',
          { step: Step.Initial },
          { attempts: 3, backoff: 1000 },
        );

        await new Promise<void>((resolve, reject) => {
          worker.on('completed', job => {
            expect(job.returnvalue).toBe(Step.Finish);
            expect(job.attemptsMade).toEqual(1);
            expect(job.attemptsStarted).toEqual(2);
            resolve();
          });
          worker.on('error', () => reject());
        });

        expect(waitingChildrenStepExecutions).toBe(2);
        await worker.close();
        await childrenWorker.close();
        await parentQueue.close();
        await removeAllQueueData(createTestConnection(), parentQueueName);
      });
    });
  });
});
