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
import { LockManager, Queue, Worker } from '../src/classes';
import { LockManagerWorkerContext } from '../src/interfaces';
import { delay, removeAllQueueData } from '../src/utils';

describe('LockManager', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('constructor', () => {
    it('should create a lock manager with worker context', () => {
      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => [],
        emit: () => true,
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 5000,
        lockDuration: 30000,
        workerId: 'worker-1',
        workerName: 'test-worker',
      });

      expect(lockManager).toBeInstanceOf(LockManager);
      expect(lockManager.isRunning()).toBe(false);
      expect(lockManager.getActiveJobCount()).toBe(0);
    });
  });

  describe('start and stop', () => {
    it('should start and stop the lock manager', async () => {
      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => [],
        emit: () => true,
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 5000,
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      expect(lockManager.isRunning()).toBe(false);

      lockManager.start();
      expect(lockManager.isRunning()).toBe(true);

      await lockManager.close();
      expect(lockManager.isRunning()).toBe(false);
    });

    it('should not start if already closed', async () => {
      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => [],
        emit: () => true,
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 5000,
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      await lockManager.close();
      lockManager.start();

      expect(lockManager.isRunning()).toBe(false);
    });

    it('should not start timer if lockRenewTime is 0', () => {
      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => [],
        emit: () => true,
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 0,
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      lockManager.start();
      expect(lockManager.isRunning()).toBe(false);
    });

    it('should handle multiple close calls gracefully', async () => {
      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => [],
        emit: () => true,
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 5000,
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      lockManager.start();
      await lockManager.close();
      await lockManager.close(); // Second close should not throw

      expect(lockManager.isRunning()).toBe(false);
    });
  });

  describe('job tracking', () => {
    it('should track and untrack jobs', () => {
      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => [],
        emit: () => true,
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 5000,
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      expect(lockManager.getActiveJobCount()).toBe(0);

      lockManager.trackJob('job-1', 'token-1', Date.now());
      expect(lockManager.getActiveJobCount()).toBe(1);

      lockManager.trackJob('job-2', 'token-2', Date.now());
      expect(lockManager.getActiveJobCount()).toBe(2);

      lockManager.untrackJob('job-1');
      expect(lockManager.getActiveJobCount()).toBe(1);

      lockManager.untrackJob('job-2');
      expect(lockManager.getActiveJobCount()).toBe(0);
    });

    it('should not track jobs after being closed', async () => {
      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => [],
        emit: () => true,
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 5000,
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      await lockManager.close();

      lockManager.trackJob('job-1', 'token-1', Date.now());
      expect(lockManager.getActiveJobCount()).toBe(0);
    });

    it('should clear all tracked jobs when closed', async () => {
      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => [],
        emit: () => true,
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 5000,
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      lockManager.trackJob('job-1', 'token-1', Date.now());
      lockManager.trackJob('job-2', 'token-2', Date.now());
      expect(lockManager.getActiveJobCount()).toBe(2);

      await lockManager.close();
      expect(lockManager.getActiveJobCount()).toBe(0);
    });

    it('should ignore empty job ids', () => {
      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => [],
        emit: () => true,
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 5000,
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      lockManager.trackJob('', 'token-1', Date.now());
      expect(lockManager.getActiveJobCount()).toBe(0);
    });
  });

  describe('lock renewal', () => {
    it('should extend locks for tracked jobs', async () => {
      // TODO: Move timeout to test options: { timeout: 10000 }

      let extendCallCount = 0;
      const extendedJobIds: string[][] = [];

      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async (jobIds, tokens, duration) => {
          extendCallCount++;
          extendedJobIds.push(jobIds);
          expect(tokens).toHaveLength(jobIds.length);
          expect(duration).toBe(30000);
          return []; // No errors
        },
        emit: () => true,
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 500, // Short for testing
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      lockManager.start();

      const now = Date.now() - 1000; // Old timestamp to trigger immediate renewal
      lockManager.trackJob('job-1', 'token-1', now);
      lockManager.trackJob('job-2', 'token-2', now);

      // Wait for lock renewal to happen
      await delay(600);

      expect(extendCallCount).to.be.gte(1);
      expect(extendedJobIds.flat()).toEqual(
        expect.arrayContaining(['job-1', 'job-2']),
      );

      await lockManager.close();
    });

    it('should emit error when lock extension fails', async () => {
      // TODO: Move timeout to test options: { timeout: 5000 }

      const emittedErrors: Error[] = [];

      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => {
          return ['job-1']; // job-1 failed to extend
        },
        emit: (event, ...args) => {
          if (event === 'error') {
            emittedErrors.push(args[0] as Error);
          }
          return true;
        },
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 200,
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      lockManager.start();

      const now = Date.now() - 1000;
      lockManager.trackJob('job-1', 'token-1', now);

      // Wait for lock renewal
      await delay(300);

      expect(emittedErrors).to.have.lengthOf.at.least(1);
      expect(emittedErrors[0].message).toContain(
        'could not renew lock for job job-1',
      );

      await lockManager.close();
    });

    it('should emit error when extendJobLocks throws', async () => {
      // TODO: Move timeout to test options: { timeout: 5000 }

      const emittedErrors: Error[] = [];
      const testError = new Error('Redis connection failed');

      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => {
          throw testError;
        },
        emit: (event, ...args) => {
          if (event === 'error') {
            emittedErrors.push(args[0] as Error);
          }
          return true;
        },
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 200,
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      lockManager.start();

      const now = Date.now() - 1000;
      lockManager.trackJob('job-1', 'token-1', now);

      // Wait for lock renewal
      await delay(300);

      expect(emittedErrors).to.have.lengthOf.at.least(1);
      expect(emittedErrors[0]).toBe(testError);

      await lockManager.close();
    });

    it('should not extend locks if no jobs need renewal', async () => {
      // TODO: Move timeout to test options: { timeout: 5000 }

      let extendCallCount = 0;

      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => {
          extendCallCount++;
          return [];
        },
        emit: () => true,
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 1000, // Longer interval for more reliable testing
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      lockManager.start();

      // Track jobs with recent timestamps (no renewal needed yet)
      const now = Date.now();
      lockManager.trackJob('job-1', 'token-1', now);
      lockManager.trackJob('job-2', 'token-2', now);

      // Wait for less than lockRenewTime/2 (500ms) - use 300ms for safety margin
      await delay(300);

      // Should not have called extend yet
      expect(extendCallCount).toBe(0);

      await lockManager.close();
    });

    it('should update timestamps for jobs without initial timestamp', async () => {
      // TODO: Move timeout to test options: { timeout: 5000 }

      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => [],
        emit: () => true,
        trace: async (_, __, ___, callback) => callback(),
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 200,
        lockDuration: 30000,
        workerId: 'worker-1',
      });

      lockManager.start();

      // Track job with 0 timestamp
      lockManager.trackJob('job-1', 'token-1', 0);

      await delay(250);

      // Job should still be tracked
      expect(lockManager.getActiveJobCount()).toBe(1);

      await lockManager.close();
    });
  });

  describe('integration with Worker', () => {
    let queue: Queue;
    let queueName: string;

    beforeEach(async () => {
      queueName = `test-lock-manager-${v4()}`;
      queue = new Queue(queueName, { connection, prefix });
    });

    afterEach(async () => {
      await queue.close();
      await removeAllQueueData(new IORedis(redisHost), queueName);
    });

    it('should track jobs during processing', async () => {
      // TODO: Move timeout to test options: { timeout: 10000 }

      let lockManagerInstance: any;
      let maxTrackedJobs = 0;

      const worker = new Worker(
        queueName,
        async job => {
          // Access the lock manager through the worker instance
          lockManagerInstance = (worker as any).lockManager;
          const currentCount = lockManagerInstance.getActiveJobCount();
          maxTrackedJobs = Math.max(maxTrackedJobs, currentCount);

          await delay(100);
          return { processed: true };
        },
        {
          connection,
          prefix,
          concurrency: 3,
        },
      );

      await worker.waitUntilReady();

      // Add multiple jobs
      await Promise.all([
        queue.add('test', { data: 1 }),
        queue.add('test', { data: 2 }),
        queue.add('test', { data: 3 }),
      ]);

      // Wait for jobs to complete
      await new Promise<void>(resolve => {
        let completed = 0;
        worker.on('completed', () => {
          completed++;
          if (completed === 3) {
            resolve();
          }
        });
      });

      // Wait a bit for the finally block to execute
      await delay(50);

      // Lock manager should have tracked jobs
      expect(maxTrackedJobs).to.be.gte(1);
      expect(maxTrackedJobs).to.be.lte(3);

      // After completion, no jobs should be tracked
      expect(lockManagerInstance.getActiveJobCount()).toBe(0);

      await worker.close();
    });

    it('should untrack jobs on failure', async () => {
      // TODO: Move timeout to test options: { timeout: 10000 }

      let lockManagerInstance: any;

      const worker = new Worker(
        queueName,
        async job => {
          lockManagerInstance = (worker as any).lockManager;
          throw new Error('Processing failed');
        },
        {
          connection,
          prefix,
        },
      );

      await worker.waitUntilReady();

      await queue.add('test', { data: 1 });

      await new Promise<void>(resolve => {
        worker.on('failed', () => {
          resolve();
        });
      });

      // Wait a bit for the finally block to execute
      await delay(50);

      // Job should be untracked after failure
      expect(lockManagerInstance.getActiveJobCount()).toBe(0);

      await worker.close();
    });

    it('should continue renewing locks for long-running jobs', async () => {
      // TODO: Move timeout to test options: { timeout: 15000 }

      let lockRenewalCount = 0;
      let lockManagerInstance: any;

      const worker = new Worker(
        queueName,
        async job => {
          lockManagerInstance = (worker as any).lockManager;

          // Simulate long-running job
          await delay(3000);
          return { processed: true };
        },
        {
          connection,
          prefix,
          lockRenewTime: 500,
          lockDuration: 2000,
        },
      );

      // Monitor lock extensions
      const originalExtendLocks = (worker as any).extendJobLocks;
      (worker as any).extendJobLocks = async function (...args: any[]) {
        lockRenewalCount++;
        return originalExtendLocks.apply(this, args);
      };

      await worker.waitUntilReady();

      await queue.add('test', { data: 1 });

      await new Promise<void>(resolve => {
        worker.on('completed', () => {
          resolve();
        });
      });

      // Lock should have been renewed multiple times during the 3-second job
      expect(lockRenewalCount).to.be.gte(2);

      await worker.close();
    });

    it('should handle lock manager closure during worker shutdown', async () => {
      // TODO: Move timeout to test options: { timeout: 10000 }

      const worker = new Worker(
        queueName,
        async job => {
          await delay(100);
          return { processed: true };
        },
        {
          connection,
          prefix,
        },
      );

      await worker.waitUntilReady();

      const lockManagerInstance = (worker as any).lockManager;

      expect(lockManagerInstance.isRunning()).toBe(true);

      await worker.close();

      expect(lockManagerInstance.isRunning()).toBe(false);
      expect(lockManagerInstance.getActiveJobCount()).toBe(0);
    });
  });

  describe('telemetry', () => {
    it('should call trace when extending locks', async () => {
      // TODO: Move timeout to test options: { timeout: 5000 }

      let traceCalled = false;

      const mockWorkerContext: LockManagerWorkerContext = {
        extendJobLocks: async () => [],
        emit: () => true,
        trace: async (spanKind, operation, destination, callback) => {
          traceCalled = true;
          expect(operation).toBe('extendLocks');
          expect(destination).toBe('test-queue');
          return callback();
        },
        name: 'test-queue',
      };

      const lockManager = new LockManager(mockWorkerContext, {
        lockRenewTime: 200,
        lockDuration: 30000,
        workerId: 'worker-1',
        workerName: 'test-worker',
      });

      lockManager.start();

      const now = Date.now() - 1000;
      lockManager.trackJob('job-1', 'token-1', now);

      await delay(300);

      expect(traceCalled).toBe(true);

      await lockManager.close();
    });
  });
});
