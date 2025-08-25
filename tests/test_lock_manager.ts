import { Queue, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';
import { default as IORedis } from 'ioredis';
import { beforeEach, describe, it, before, after as afterAll } from 'mocha';
import { v4 } from 'uuid';
import { expect } from 'chai';

describe('Lock Manager', function () {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let queue: Queue;
  let queueName: string;
  let connection: IORedis;

  before(async function () {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
  });

  afterEach(async function () {
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('Sharing worker thread', function () {
    it('should use lock manager for basic job processing', async function () {
      this.timeout(3000);

      let completedJobs = 0;

      const worker = new Worker(
        queueName,
        async job => {
          await delay(10);
          return { success: true, id: job.id };
        },
        {
          connection,
          prefix,
          lockDuration: 500,
          lockRenewTime: 200,
        },
      );

      worker.on('completed', () => {
        completedJobs++;
      });

      await worker.waitUntilReady();

      // Add a job first to trigger worker main loop
      const job = await queue.add('test-job', { data: 'test' });

      // Give some time for the worker to start
      await delay(100);

      // Check that lock manager is initialized
      expect(worker.isLockManagerRunning()).to.be.true;

      // Wait for completion
      await delay(500);

      expect(completedJobs).to.equal(1);

      await worker.close();
    });

    it('should handle job tracking correctly', async function () {
      this.timeout(3000);

      let jobsProcessed = 0;
      const jobProcessingTimes: number[] = [];

      const worker = new Worker(
        queueName,
        async job => {
          const start = Date.now();
          await delay(50); // Simulate some work
          jobProcessingTimes.push(Date.now() - start);
          jobsProcessed++;
          return { success: true };
        },
        {
          connection,
          prefix,
          lockDuration: 500,
          lockRenewTime: 200,
        },
      );

      await worker.waitUntilReady();

      // Add multiple jobs
      const promises: any[] = [];
      for (let i = 0; i < 3; i++) {
        promises.push(queue.add(`job-${i}`, { index: i }));
      }
      await Promise.all(promises);

      // Wait for all jobs to complete
      await delay(1000);

      expect(jobsProcessed).to.equal(3);
      expect(worker['lockManager']?.getActiveJobCount()).to.equal(0); // All jobs should be removed after completion

      await worker.close();
    });

    it('should handle concurrent jobs with lock management', async function () {
      this.timeout(3000);

      let completedJobs = 0;

      const worker = new Worker(
        queueName,
        async job => {
          // Variable processing time
          const processingTime = 20 + Math.random() * 30;
          await delay(processingTime);
          return { success: true, processingTime };
        },
        {
          connection,
          prefix,
          concurrency: 3, // Process multiple jobs concurrently
          lockDuration: 500,
          lockRenewTime: 200,
        },
      );

      worker.on('completed', () => {
        completedJobs++;
      });

      await worker.waitUntilReady();

      // Add multiple jobs
      const jobCount = 6;
      for (let i = 0; i < jobCount; i++) {
        await queue.add(`concurrent-job-${i}`, { index: i });
      }

      // Wait for completion
      await delay(1000);

      expect(completedJobs).to.equal(jobCount);

      await worker.close();
    });

    it('should handle errors gracefully', async function () {
      this.timeout(3000);

      let completedJobs = 0;
      let failedJobs = 0;
      const errors: Error[] = [];

      const worker = new Worker(
        queueName,
        async job => {
          if (job.data.shouldFail) {
            throw new Error('Intentional failure');
          }
          await delay(10);
          return { success: true };
        },
        {
          connection,
          prefix,
          lockDuration: 500,
          lockRenewTime: 200,
        },
      );

      worker.on('completed', () => {
        completedJobs++;
      });

      worker.on('failed', () => {
        failedJobs++;
      });

      worker.on('error', error => {
        errors.push(error);
      });

      await worker.waitUntilReady();

      // Add mix of successful and failing jobs
      await queue.add('success-1', { shouldFail: false });
      await queue.add('fail-1', { shouldFail: true });
      await queue.add('success-2', { shouldFail: false });

      await delay(500);

      expect(completedJobs).to.be.greaterThan(0);
      expect(failedJobs).to.be.greaterThan(0);

      await worker.close();
    });

    it('should properly clean up resources', async function () {
      this.timeout(2000);

      const worker = new Worker(
        queueName,
        async job => {
          await delay(10);
          return { success: true };
        },
        {
          connection,
          prefix,
          lockDuration: 500,
          lockRenewTime: 200,
        },
      );

      await worker.waitUntilReady();

      // Add a dummy job to start the lock manager
      await queue.add('test-job', { data: 'test' });
      await delay(100);

      // Verify lock manager is running
      expect(worker.isLockManagerRunning()).to.be.true;

      await worker.close();

      // Verify lock manager is stopped
      expect(worker.isLockManagerRunning()).to.be.false;
    });
  });
});
