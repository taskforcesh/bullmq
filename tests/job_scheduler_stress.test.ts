import { after } from 'lodash';
import { default as IORedis } from 'ioredis';
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
import { Job, Queue, QueueEvents, Repeat, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

const ONE_SECOND = 1000;
const ONE_MINUTE = 60 * ONE_SECOND;
const ONE_HOUR = 60 * ONE_MINUTE;

describe('Job Scheduler Stress', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  // TODO: Move timeout to test options: { timeout: 10000 }
  let repeat: Repeat;
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  let connection: IORedis;
  beforeAll(async () => {
    connection = new IORedis(redisHost, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      reconnectOnError: () => true,
    });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    repeat = new Repeat(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queue.waitUntilReady();
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    try {
      await queue.close();
      await repeat.close();
      await queueEvents.close();
      await removeAllQueueData(new IORedis(redisHost), queueName);
    } catch (error) {
      // Ignore errors in cleanup (happens sometimes with Dragonfly in MacOS)
    }
  });

  afterAll(async function () {
    await connection.quit();
  });

  it('should upsert many times respecting the guarantees', async () => {
    const worker = new Worker(queueName, async job => {}, {
      connection,
      concurrency: 1,
      prefix,
    });

    const maxIterations = 10;
    const completing = new Promise((resolve, reject) => {
      worker.on('completed', after(maxIterations, resolve));

      queueEvents.on('duplicated', reject);
    });

    const jobSchedulerId = 'test';
    let previousJob;
    let every = 800;
    for (let i = 0; i < 3; i++) {
      if (previousJob) {
        await delay(200);

        // Ensure that there is exactly one delayed job in the queue.
        // This validates that the upsertJobScheduler method replaces the previous job
        // and maintains only one delayed or waiting job at a time, as expected.
        const count = await queue.getJobCountByTypes(
          'active',
          'delayed',
          'waiting',
        );
        expect(count).to.be.gte(1);
        // previous job can be active while a delayed or waiting job is added
        expect(count).to.be.lte(2);
      }
      previousJob = await queue.upsertJobScheduler(
        jobSchedulerId,
        {
          every,
        },
        {
          data: {
            iteration: i,
          },
          opts: {
            removeOnComplete: true,
          },
        },
      );
      every = every / 2;
    }

    await completing;
    try {
      await worker.close();
    } catch (error) {
      // Ignore errors in cleanup (happens sometimes with Dragonfly in MacOS)
    }

    const repeatableJobs = await queue.getJobSchedulers();
    expect(repeatableJobs).toHaveLength(1);

    const counts = await queue.getJobCounts();

    expect(counts).toEqual({
      active: 0,
      completed: 0,
      delayed: 1,
      failed: 0,
      paused: 0,
      prioritized: 0,
      waiting: 0,
      'waiting-children': 0,
    });
  });

  it('should start processing a job as soon as it is upserted when using every', async () => {
    const worker = new Worker(
      queueName,
      async job => {
        return 42;
      },
      {
        connection,
        concurrency: 1,
        prefix,
      },
    );

    await worker.waitUntilReady();

    const waitingCompleted = new Promise<void>(resolve => {
      worker.on('completed', () => {
        resolve();
      });
    });

    await queue.upsertJobScheduler(
      '1s-test',
      {
        every: 4_000,
      },
      {
        name: '1s-test',
      },
    );

    const timestamp = Date.now();
    await waitingCompleted;

    const diff = Date.now() - timestamp;
    expect(diff).toBeLessThan(ONE_SECOND);
    try {
      await worker.close();
    } catch (error) {
      // Ignore errors in cleanup (happens sometimes with Dragonfly in MacOS)
    }
  });

  it.skip('should upsert many times with different settings respecting the guarantees', async () => {
    const worker = new Worker(
      queueName,
      async job => {
        return 42;
      },
      {
        connection,
        concurrency: 1,
        autorun: false,
      },
    );

    let completedJobs = 0;
    worker.on('completed', async job => {
      completedJobs++;
    });

    worker.run();

    const queue = new Queue(queueName, {
      connection,
    });

    const maxIterations = 100;
    const jobSchedulerId = 'test';
    for (let i = 0; i < maxIterations; i++) {
      await queue.upsertJobScheduler(
        jobSchedulerId,
        {
          every: ONE_HOUR * (i + 1),
        },
        {
          data: {
            iteration: i,
          },
        },
      );
    }

    try {
      await worker.close();
    } catch (error) {
      // Ignore errors in cleanup (happens sometimes with Dragonfly in MacOS)
    }

    const repeatableJobs = await queue.getJobSchedulers();
    expect(repeatableJobs).toHaveLength(1);

    const counts = await queue.getJobCounts();

    expect(counts).toEqual({
      active: 0,
      completed: 1,
      delayed: 1,
      failed: 0,
      paused: 0,
      prioritized: 0,
      waiting: 0,
      'waiting-children': 0,
    });

    expect(completedJobs).toEqual(1);
    try {
      await queue.close();
    } catch (error) {
      // Ignore errors in cleanup (happens sometimes with Dragonfly in MacOS)
    }
  });

  it(
    'should properly update job data and options when upserting job scheduler multiple times',
    { timeout: 30000 },
    async () => {
      const jobSchedulerId = 'update-test-scheduler';
      const processedJobs: any[] = [];
      const expectedDataSequence = ['first', 'second'];
      let currentSequenceIndex = 0;

      const worker = new Worker(
        queueName,
        async job => {
          processedJobs.push({
            name: job.name,
            data: job.data,
            processedAt: Date.now(),
          });

          // Validate that job data is updated correctly
          if (processedJobs.length > 3) {
            // Allow some initial jobs to process
            const expectedKey =
              expectedDataSequence[
                currentSequenceIndex % expectedDataSequence.length
              ];
            expect(job.data.key).toBe(
              expectedKey,
              `Expected job data key to be '${expectedKey}' but got '${job.data.key}' for job #${processedJobs.length}`,
            );
          }
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      // First upsert - create scheduler with initial data
      await queue.upsertJobScheduler(
        jobSchedulerId,
        { every: 1000 },
        {
          name: 'my-name-1',
          data: { key: 'first' },
        },
      );

      // Let a few jobs process with the first data
      await delay(3500); // Allow 3-4 jobs to process

      const jobsAfterFirst = processedJobs.length;
      expect(jobsAfterFirst).to.be.gte(3);

      // Verify all initial jobs have the correct data
      for (let i = 0; i < jobsAfterFirst; i++) {
        expect(processedJobs[i].data.key).toBe('first');
        expect(processedJobs[i].name).toBe('my-name-1');
      }

      // Second upsert - update data and timing
      const every2 = 500;
      currentSequenceIndex = 1;
      await queue.upsertJobScheduler(
        jobSchedulerId,
        { every: every2 }, // Change timing
        {
          name: 'my-name-2',
          data: { key: 'second' },
        },
      );

      // Let jobs process with updated data
      await delay(6500); // Allow 3 more jobs to process at new interval

      const jobsAfterSecond = processedJobs.length;
      expect(jobsAfterSecond).to.be.gt(jobsAfterFirst);

      // Verify that jobs after the update have the new data
      // Note: There might be 1-2 jobs in transition that still have old data
      const newJobs = processedJobs.slice(jobsAfterFirst + 2); // Skip transition jobs
      expect(newJobs.length).to.be.gte(1);

      for (const job of newJobs) {
        expect(job.data.key).toBe(
          'second',
          `Job should have updated data 'second' but has '${job.data.key}'`,
        );
        expect(job.name).toBe('my-name-2');
      }

      // We close the worker first, to avoid a possible edge case where
      // a job has been exactly moved to active but still not added the next delayed job
      try {
        await worker.close();
      } catch (error) {
        // Ignore errors in cleanup (happens sometimes with Dragonfly in MacOS)
      }

      // Verify job scheduler metadata was updated correctly
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers).toHaveLength(1);
      expect(schedulers[0].key).toBe(jobSchedulerId);
      expect(schedulers[0].every).toBe(every2);

      // Verify that only one delayed job exists (proper replacement)
      const delayedJobs = await queue.getDelayed();
      expect(delayedJobs).toHaveLength(1);
      expect(delayedJobs[0].data.key).toBe('second');
      expect(delayedJobs[0].name).toBe('my-name-2');
    },
  );

  it('should handle rapid successive upserts without creating duplicate schedulers', async () => {
    // TODO: Move timeout to test options: { timeout: 15000 }

    const jobSchedulerId = 'rapid-upsert-test';
    const processedJobs: any[] = [];

    const worker = new Worker(
      queueName,
      async job => {
        processedJobs.push({
          name: job.name,
          data: job.data,
          iteration: job.data.iteration,
        });
      },
      { connection, prefix },
    );

    await worker.waitUntilReady();

    // Perform rapid successive upserts
    const upsertPromises: Promise<any>[] = [];
    for (let i = 0; i < 5; i++) {
      const promise = queue.upsertJobScheduler(
        jobSchedulerId,
        { every: 1000 + i * 200 }, // Vary timing slightly
        {
          name: `iteration-${i}`,
          data: { iteration: i, timestamp: Date.now() },
        },
      );
      upsertPromises.push(promise);

      // Small delay between upserts to simulate real-world timing
      if (i < 4) {
        await delay(50);
      }
    }

    // Wait for all upserts to complete
    await Promise.all(upsertPromises);

    // Allow some jobs to process
    await delay(4000);

    // Verify only one scheduler exists
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0].key).toBe(jobSchedulerId);

    // Verify only one delayed job exists
    const delayedJobs = await queue.getDelayed();
    expect(delayedJobs).toHaveLength(1);

    // The final job should reflect the last upsert
    const finalDelayedJob = delayedJobs[0];
    expect(finalDelayedJob.data.iteration).toBe(4);
    expect(finalDelayedJob.name).toBe('iteration-4');

    // Verify no duplicate events were emitted
    let duplicateEventCount = 0;
    queueEvents.on('duplicated', () => {
      duplicateEventCount++;
    });

    await delay(1000);
    expect(duplicateEventCount).toBe(0);

    try {
      await worker.close();
    } catch (error) {
      // Ignore errors in cleanup (happens sometimes with Dragonfly in MacOS)
    }
  });

  describe("when using 'every' option and jobs are moved to active some time after delay", function () {
    it('should repeat every 2 seconds and start immediately', async () => {
      let iterationCount = 0;
      const MINIMUM_DELAY_THRESHOLD_MS = 1850;
      const DELAY = 2000;

      const worker = new Worker(
        queueName,
        async job => {
          try {
            if (iterationCount === 0) {
              expect(job.opts.delay).to.be.eq(0);
            } else {
              expect(job.opts.delay).to.be.gte(MINIMUM_DELAY_THRESHOLD_MS);
              expect(job.opts.delay).to.be.lte(DELAY);
            }
            iterationCount++;
          } catch (err) {
            console.log(err);
            throw err;
          }
        },
        { autorun: false, connection, prefix },
      );

      let prev: Job;
      let counter = 0;

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async job => {
          try {
            if (prev) {
              expect(prev.timestamp).to.be.lte(job.timestamp);
              expect(job.processedOn! - prev.processedOn!).to.be.gte(
                MINIMUM_DELAY_THRESHOLD_MS,
              );
            }
            prev = job;
            counter++;
            if (counter === 5) {
              resolve();
            }
          } catch (err) {
            console.log(err);
            reject(err);
          }
        });
      });

      await queue.upsertJobScheduler(
        'repeat',
        {
          every: DELAY,
        },
        { data: { foo: 'bar' } },
      );

      const waitingCountBefore = await queue.getWaitingCount();
      expect(waitingCountBefore).to.be.eq(1);

      worker.run();

      await completing;

      const waitingCount = await queue.getWaitingCount();
      expect(waitingCount).to.be.eq(0);

      const delayedCountAfter = await queue.getDelayedCount();
      expect(delayedCountAfter).to.be.eq(1);

      try {
        await worker.close();
      } catch (error) {
        // Ignore errors in cleanup (happens sometimes with Dragonfly in MacOS)
      }
    });
  });

  describe('when disconnection happens', () => {
    it('should retry to update job scheduler', async () => {
      let iterationCount = 0;
      const DELAY = 500;

      const worker = new Worker(
        queueName,
        async () => {
          try {
            await delay(100);
            iterationCount++;
          } catch (err) {
            console.log(err);
            throw err;
          }
        },
        { autorun: false, connection, prefix, runRetryDelay: 50 },
      );

      let counter = 0;

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async () => {
          try {
            counter++;
            if (counter === 5) {
              resolve();
            }
          } catch (err) {
            console.log(err);
            reject(err);
          }
        });
        worker.on('error', err => {
          reject(err);
        });
      });

      await queue.upsertJobScheduler(
        'repeat',
        {
          every: DELAY,
        },
        { data: { foo: 'bar' } },
      );

      const waitingCountBefore = await queue.getWaitingCount();
      expect(waitingCountBefore).to.be.eq(1);

      worker.run();
      await delay(100);
      await connection.disconnect();
      await delay(100);
      await connection.connect();

      await delay(100);
      await connection.disconnect();
      await delay(100);
      await connection.connect();

      await completing;

      const waitingCount = await queue.getWaitingCount();
      expect(waitingCount).to.be.eq(0);

      const delayedCountAfter = await queue.getDelayedCount();
      expect(delayedCountAfter).to.be.eq(1);

      await worker.close();
    });
  });
});
