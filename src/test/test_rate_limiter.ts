import { Queue } from '@src/classes';
import { QueueEvents } from '@src/classes/queue-events';
import { QueueScheduler } from '@src/classes/queue-scheduler';
import { Worker } from '@src/classes/worker';
import { assert, expect } from 'chai';
import * as IORedis from 'ioredis';
import { after, every, last } from 'lodash';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { removeAllQueueData } from '@src/utils';

describe('Rate Limiter', function() {
  let queue: Queue;
  let queueName: string;
  let queueEvents: QueueEvents;

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
    queueEvents = new QueueEvents(queueName);
    await queueEvents.waitUntilReady();
  });

  afterEach(async function() {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should put a job into the delayed queue when limit is hit', async () => {
    const worker = new Worker(queueName, async job => {}, {
      limiter: {
        max: 1,
        duration: 1000,
      },
    });
    await worker.waitUntilReady();

    queueEvents.on('failed', ({ failedReason }) => {
      assert.fail(failedReason);
    });

    await Promise.all([
      queue.add('test', {}),
      queue.add('test', {}),
      queue.add('test', {}),
      queue.add('test', {}),
    ]);

    await Promise.all([
      worker.getNextJob('test-token'),
      worker.getNextJob('test-token'),
      worker.getNextJob('test-token'),
      worker.getNextJob('test-token'),
    ]);

    const delayedCount = await queue.getDelayedCount();
    expect(delayedCount).to.eq(3);
  });

  it('should obey the rate limit', async function() {
    this.timeout(20000);

    const numJobs = 4;
    const startTime = new Date().getTime();

    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const worker = new Worker(queueName, async job => {}, {
      limiter: {
        max: 1,
        duration: 1000,
      },
    });

    const result = new Promise((resolve, reject) => {
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
    await queueScheduler.close();
  });

  it('should rate limit by grouping', async function() {
    this.timeout(20000);

    const numGroups = 4;
    const numJobs = 20;
    const startTime = Date.now();

    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const rateLimitedQueue = new Queue(queueName, {
      limiter: {
        groupKey: 'accountId',
      },
    });

    const worker = new Worker(queueName, async job => {}, {
      limiter: {
        max: 1,
        duration: 1000,
        groupKey: 'accountId',
      },
    });

    const completed: { [index: string]: number[] } = {};

    const running = new Promise((resolve, reject) => {
      const afterJobs = after(numJobs, () => {
        try {
          const timeDiff = Date.now() - startTime;
          expect(timeDiff).to.be.gte(numGroups * 1000);
          expect(timeDiff).to.be.below((numGroups + 1) * 1100);

          for (const group in completed) {
            let prevTime = completed[group][0];
            for (let i = 1; i < completed[group].length; i++) {
              const diff = completed[group][i] - prevTime;
              expect(diff).to.be.below(2000);
              expect(diff).to.be.gte(1000);
              prevTime = completed[group][i];
            }
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      queueEvents.on('completed', ({ jobId }) => {
        const group = last(jobId.split(':'));
        completed[group] = completed[group] || [];
        completed[group].push(Date.now());

        afterJobs();
      });

      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });
    });

    for (let i = 0; i < numJobs; i++) {
      await rateLimitedQueue.add('rate test', { accountId: i % numGroups });
    }

    await running;
    await rateLimitedQueue.close();
    await worker.close();
    await queueScheduler.close();
  });

  it.skip('should obey priority', async function() {
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
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

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
        limiter: {
          max: 1,
          duration: 10,
        },
      },
    );
    await worker.waitUntilReady();

    await queue.resume();

    const result = new Promise((resolve, reject) => {
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
    await queueScheduler.close();
  });
});
