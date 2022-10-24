import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { after, every } from 'lodash';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { Queue, QueueEvents, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Rate Limiter', function () {
  let queue: Queue;
  let queueName: string;
  let queueEvents: QueueEvents;

  const connection = { host: 'localhost' };

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection });
    queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();
  });

  afterEach(async function () {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should not put a job into the delayed queue when limit is hit', async function () {
    this.timeout(6000);
    const numJobs = 5;
    const worker = new Worker(
      queueName,
      async () => {
        await delay(200);
      },
      {
        connection,
        concurrency: 5,
        limiter: {
          max: 1,
          duration: 1000,
        },
      },
    );
    await worker.waitUntilReady();

    queueEvents.on('failed', () => {});

    const jobs = Array.from(Array(numJobs).keys()).map(() => ({
      name: 'test',
      data: {},
    }));
    await queue.addBulk(jobs);

    await delay(100);

    const delayedCount = await queue.getDelayedCount();
    expect(delayedCount).to.equal(0);
    await worker.close();
  });

  it('should obey the rate limit', async function () {
    this.timeout(20000);

    const numJobs = 10;

    const worker = new Worker(queueName, async () => {}, {
      connection,
      limiter: {
        max: 1,
        duration: 1000,
      },
    });

    const result = new Promise<void>((resolve, reject) => {
      queueEvents.on(
        'completed',
        // after every job has been completed
        after(numJobs, async () => {
          await worker.close();

          try {
            const timeDiff = new Date().getTime() - startTime;
            expect(timeDiff).to.be.gte((numJobs - 1) * 1000);
            resolve();
          } catch (err) {
            reject(err);
          }
        }),
      );

      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });
    });

    const startTime = new Date().getTime();
    const jobs = Array.from(Array(numJobs).keys()).map(() => ({
      name: 'rate test',
      data: {},
    }));
    await queue.addBulk(jobs);

    await result;
    await worker.close();
  });

  it('should obey the rate limit with max value greater than 1', async function () {
    this.timeout(20000);

    const numJobs = 10;

    const worker = new Worker(queueName, async () => {}, {
      connection,
      limiter: {
        max: 2,
        duration: 1000,
      },
    });

    const result = new Promise<void>((resolve, reject) => {
      queueEvents.on(
        'completed',
        // after every job has been completed
        after(numJobs, async () => {
          await worker.close();

          try {
            const timeDiff = new Date().getTime() - startTime;
            expect(timeDiff).to.be.gte(numJobs / 2 - 1 * 1000);
            resolve();
          } catch (err) {
            reject(err);
          }
        }),
      );

      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });
    });

    const startTime = new Date().getTime();
    const jobs = Array.from(Array(numJobs).keys()).map(() => ({
      name: 'rate test',
      data: {},
    }));
    await queue.addBulk(jobs);

    await result;
    await worker.close();
  });

  it('should obey the rate limit with dynamic limit', async function () {
    this.timeout(5000);

    const numJobs = 10;
    const dynamicLimit = 250;
    const duration = 100;

    const worker = new Worker(
      queueName,
      async job => {
        if (job.attemptsMade === 1) {
          await worker.rateLimit(dynamicLimit);
          throw Worker.RateLimitError();
        }
      },
      {
        connection,
        limiter: {
          max: 1,
          duration,
        },
      },
    );

    const result = new Promise<void>((resolve, reject) => {
      queueEvents.on(
        'completed',
        // after every job has been completed
        after(numJobs, async () => {
          await worker.close();

          try {
            const timeDiff = new Date().getTime() - startTime;
            expect(timeDiff).to.be.gte(
              numJobs * dynamicLimit + numJobs * duration,
            );
            resolve();
          } catch (err) {
            reject(err);
          }
        }),
      );

      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });
    });

    const startTime = new Date().getTime();
    const jobs = Array.from(Array(numJobs).keys()).map(() => ({
      name: 'rate test',
      data: {},
    }));
    await queue.addBulk(jobs);

    await result;
    await worker.close();
  });

  it('should obey the rate limit with workerDelay enabled', async function () {
    this.timeout(20000);

    const numJobs = 4;
    const startTime = new Date().getTime();

    const worker = new Worker(queueName, async () => {}, {
      connection,
      limiter: {
        max: 1,
        duration: 1000,
        workerDelay: true,
      },
    });

    const result = new Promise<void>((resolve, reject) => {
      queueEvents.on(
        'completed',
        // after every job has been completed
        after(numJobs, async () => {
          await worker.close();

          try {
            const timeDiff = new Date().getTime() - startTime;
            expect(timeDiff).to.be.gte((numJobs - 1) * 1000);
            resolve();
          } catch (err) {
            reject(err);
          }
        }),
      );

      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });
    });

    for (let i = 0; i < numJobs; i++) {
      await queue.add('rate test', {});
    }

    await result;
    await worker.close();
  });

  it('should obey priority', async function () {
    this.timeout(20000);

    const numJobs = 10;
    const priorityBuckets: { [key: string]: number } = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
    };

    await queue.pause();

    for (let i = 0; i < numJobs; i++) {
      const priority = (i % 4) + 1;
      const opts = { priority };

      priorityBuckets[priority] = priorityBuckets[priority] + 1;

      await queue.add('priority test', { id: i }, opts);
    }

    const priorityBucketsBefore = { ...priorityBuckets };

    const worker = new Worker(
      queueName,
      async job => {
        const { priority } = job.opts;

        priorityBuckets[priority] = priorityBuckets[priority] - 1;

        for (let p = 1; p < priority; p++) {
          if (priorityBuckets[p] > 0) {
            const before = JSON.stringify(priorityBucketsBefore);
            const after = JSON.stringify(priorityBuckets);
            throw new Error(
              `Priority was not enforced, job with priority ${priority} was processed before all jobs with priority ${p}
              were processed. Bucket counts before: ${before} / after: ${after}`,
            );
          }
        }

        return Promise.resolve();
      },
      {
        connection,
        limiter: {
          max: 1,
          duration: 10,
        },
      },
    );
    await worker.waitUntilReady();

    await queue.resume();

    const result = new Promise<void>((resolve, reject) => {
      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });

      queueEvents.on(
        'completed',
        after(numJobs, () => {
          try {
            expect(every(priorityBuckets, value => value === 0)).to.eq(true);
            resolve();
          } catch (err) {
            reject(err);
          }
        }),
      );
    });

    await result;
    await worker.close();
  });
});
