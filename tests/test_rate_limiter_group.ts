import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { after, last } from 'lodash';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { Queue, QueueEvents, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Rate Limiter Groups', function () {
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

  describe('when promoting', function () {
    it('moves job to delayed status when is in rate limit', async function () {
      const rateLimitedQueue = new Queue(queueName, {
        connection,
        limiter: {
          groupKey: 'accountId',
        },
      });
      const worker = new Worker(queueName, null, {
        connection,
        limiter: {
          max: 1,
          duration: 1000,
          groupKey: 'accountId',
        },
      });
      const job = await rateLimitedQueue.add('rate test', {
        accountId: 'account1',
      });
      const job2 = await rateLimitedQueue.add('rate test', {
        accountId: 'account1',
      });

      await worker.getNextJob('0');
      await worker.getNextJob('0');
      const isActive = await job.isActive();
      expect(isActive).to.be.equal(true);

      const isDelayed = await job2.isDelayed();
      expect(isDelayed).to.be.equal(true);

      await job.moveToCompleted('return value', '0');
      await job2.promote();
      await worker.getNextJob('0');

      const isStillDelayed = await job2.isDelayed();
      expect(isStillDelayed).to.be.equal(true);

      await rateLimitedQueue.close();
      await worker.close();
    });

    it('moves job to wait status after rate limit', async function () {
      const rateLimitedQueue = new Queue(queueName, {
        connection,
        limiter: {
          groupKey: 'accountId',
        },
      });
      const worker = new Worker(queueName, null, {
        connection,
        limiter: {
          max: 1,
          duration: 1000,
          groupKey: 'accountId',
        },
      });
      const job = await rateLimitedQueue.add('rate test', {
        accountId: 'account1',
      });
      const job2 = await rateLimitedQueue.add('rate test', {
        accountId: 'account1',
      });

      await worker.getNextJob('0');
      await worker.getNextJob('0');
      const isActive1 = await job.isActive();
      expect(isActive1).to.be.equal(true);

      const isDelayed = await job2.isDelayed();
      expect(isDelayed).to.be.equal(true);

      await job.moveToCompleted('return value', '0');
      await delay(1000);
      await job2.promote();

      const isWaiting = await job2.isWaiting();
      expect(isWaiting).to.be.equal(true);

      await worker.getNextJob('0');

      const isActive2 = await job2.isActive();
      expect(isActive2).to.be.equal(true);

      await rateLimitedQueue.close();
      await worker.close();
    });
  });

  describe('when added job does not contain groupKey and fails', function () {
    it('should move job to wait after retry', async function () {
      const rateLimitedQueue = new Queue(queueName, {
        connection,
        limiter: {
          groupKey: 'accountId',
        },
      });
      const worker = new Worker(queueName, null, {
        connection,
        limiter: {
          max: 1,
          duration: 1000,
          groupKey: 'accountId',
        },
      });

      const token = 'my-token';
      const token2 = 'my-token2';
      await rateLimitedQueue.add('rate test', {});

      const job = await worker.getNextJob(token);
      await job.moveToFailed(new Error('test error'), token);

      const isFailed = await job.isFailed();
      expect(isFailed).to.be.equal(true);
      await job.retry();
      await worker.getNextJob(token2);
      const isDelayed = await job.isDelayed();

      expect(isDelayed).to.be.equal(false);

      await worker.close();
      await rateLimitedQueue.close();
    });
  });

  it('should rate limit by grouping', async function () {
    this.timeout(20000);

    const numGroups = 4;
    const numJobs = 20;
    const startTime = Date.now();

    const rateLimitedQueue = new Queue(queueName, {
      connection,
      limiter: {
        groupKey: 'accountId',
      },
    });

    const worker = new Worker(queueName, async () => {}, {
      connection,
      limiter: {
        max: 1,
        duration: 1000,
        groupKey: 'accountId',
      },
    });

    const completed: { [index: string]: number[] } = {};

    const running = new Promise<void>((resolve, reject) => {
      const afterJobs = after(numJobs, () => {
        try {
          const timeDiff = Date.now() - startTime;
          // In some test envs, these timestamps can drift.
          expect(timeDiff).to.be.gte(numGroups * 990);
          expect(timeDiff).to.be.below((numGroups + 1) * 1500);

          for (const group in completed) {
            let prevTime = completed[group][0];
            for (let i = 1; i < completed[group].length; i++) {
              const diff = completed[group][i] - prevTime;
              expect(diff).to.be.below(2100);
              expect(diff).to.be.gte(970);
              prevTime = completed[group][i];
            }
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      queueEvents.on('completed', ({ jobId }) => {
        const group: string = last(jobId.split(':'));
        completed[group] = completed[group] || [];
        completed[group].push(Date.now());

        afterJobs();
      });

      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });
    });

    const jobs = Array.from(Array(numJobs).keys()).map((_, index) => ({
      name: 'rate test',
      data: { accountId: index % numGroups },
    }));
    await rateLimitedQueue.addBulk(jobs);

    await running;
    await rateLimitedQueue.close();
    await worker.close();
  });

  it('should not obey rate limit by grouping if groupKey is missing', async function () {
    const numJobs = 20;
    const startTime = Date.now();

    const rateLimitedQueue = new Queue(queueName, {
      connection,
      limiter: {
        groupKey: 'accountId',
      },
    });

    const worker = new Worker(queueName, async () => {}, {
      connection,
      limiter: {
        max: 1,
        duration: 1000,
        groupKey: 'accountId',
      },
    });

    const completed: { [index: string]: number } = {};

    const running = new Promise<void>((resolve, reject) => {
      const afterJobs = after(numJobs, () => {
        try {
          const timeDiff = Date.now() - startTime;
          // In some test envs, these timestamps can drift.
          expect(timeDiff).to.be.gte(15);
          expect(timeDiff).to.be.below(325);

          let count = 0;
          let prevTime;
          for (const id in completed) {
            if (count === 0) {
              prevTime = completed[id];
            } else {
              const diff = completed[id] - prevTime;
              expect(diff).to.be.below(25);
              expect(diff).to.be.gte(0);
              prevTime = completed[id];
            }
            count++;
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      queueEvents.on('completed', ({ jobId }) => {
        const id: string = last(jobId.split(':'));
        completed[id] = Date.now();

        afterJobs();
      });

      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });
    });

    for (let i = 0; i < numJobs; i++) {
      await rateLimitedQueue.add('rate test', {});
    }

    await running;
    await rateLimitedQueue.close();
    await worker.close();
  });
});
