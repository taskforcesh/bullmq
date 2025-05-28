import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { beforeEach, describe, it, before, after as afterAll } from 'mocha';

import { v4 } from 'uuid';
import { Job, Queue, QueueEvents, Repeat, Worker } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

const ONE_SECOND = 1000;
const ONE_MINUTE = 60 * ONE_SECOND;
const ONE_HOUR = 60 * ONE_MINUTE;

describe('Job Scheduler Stress', function () {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  this.timeout(10000);
  let repeat: Repeat;
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  let connection;
  before(async function () {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    repeat = new Repeat(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queue.waitUntilReady();
    await queueEvents.waitUntilReady();
  });

  afterEach(async function () {
    await queue.close();
    await repeat.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  it('should upsert many times respecting the guarantees', async () => {
    const worker = new Worker(
      queueName,
      async job => {
        return 42;
      },
      {
        connection,
        concurrency: 1,
        autorun: false,
        prefix,
      },
    );

    let completedJobs = 0;
    worker.on('completed', async job => {
      completedJobs++;
    });

    worker.run();

    const maxIterations = 100;
    const jobSchedulerId = 'test';
    for (let i = 0; i < maxIterations; i++) {
      await queue.upsertJobScheduler(
        jobSchedulerId,
        {
          every: ONE_HOUR,
        },
        {
          data: {
            iteration: i,
          },
        },
      );
    }

    await worker.close();

    const repeatableJobs = await queue.getJobSchedulers();
    expect(repeatableJobs).to.have.length(1);

    const counts = await queue.getJobCounts();

    expect(counts).to.be.eql({
      active: 0,
      completed: 1,
      delayed: 1,
      failed: 0,
      paused: 0,
      prioritized: 0,
      waiting: 0,
      'waiting-children': 0,
    });

    expect(completedJobs).to.be.eql(1);
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
    expect(diff).to.be.lessThan(ONE_SECOND);
    await worker.close();
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

    await worker.close();

    const repeatableJobs = await queue.getJobSchedulers();
    expect(repeatableJobs).to.have.length(1);

    const counts = await queue.getJobCounts();

    expect(counts).to.be.eql({
      active: 0,
      completed: 1,
      delayed: 1,
      failed: 0,
      paused: 0,
      prioritized: 0,
      waiting: 0,
      'waiting-children': 0,
    });

    expect(completedJobs).to.be.eql(1);
    await queue.close();
  });

  describe("when using 'every' option and jobs are moved to active some time after delay", function () {
    it('should repeat every 2 seconds and start immediately', async function () {
      let iterationCount = 0;
      const worker = new Worker(
        queueName,
        async job => {
          if (iterationCount === 0) {
            expect(job.opts.delay).to.be.eq(0);
          } else {
            expect(job.opts.delay).to.be.gte(1850);
          }
          iterationCount++;
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
              expect(job.processedOn! - prev.processedOn!).to.be.gte(1950);
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
          every: 2000,
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

      await worker.close();
    });
  });
});
