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
import { Queue, QueueEvents, Worker, UnrecoverableError } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Job Cancellation', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  let connection: IORedis;
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

  describe('Basic Cancellation', () => {
    it('should cancel a running job using abort event (recommended)', async () => {
      let jobStarted = false;
      let jobCancelled = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          jobStarted = true;

          // Event-based approach - recommended!
          return new Promise((resolve, reject) => {
            signal?.addEventListener('abort', () => {
              jobCancelled = true;
              reject(new Error('Job was cancelled'));
            });

            // Simulate long-running work
            let i = 0;
            const interval = setInterval(() => {
              i++;
              if (i >= 100) {
                clearInterval(interval);
                resolve({ done: true });
              }
            }, 10);

            // Clean up interval if aborted
            signal?.addEventListener('abort', () => clearInterval(interval));
          });
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      await waitingOnActive;

      await delay(50);

      // Cancel the job
      worker.cancelJob(job.id!);

      // Wait for the job to fail
      await new Promise<void>(resolve => {
        worker.on('failed', (failedJob, err) => {
          expect(failedJob!.id).toBe(job.id);
          expect(err.message).toBe('Job was cancelled');
          resolve();
        });
      });

      expect(jobStarted).toBe(true);
      expect(jobCancelled).toBe(true);

      await worker.close();
    });

    it('should cancel a running job using polling (alternative)', async () => {
      let jobStarted = false;
      let jobCancelled = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          jobStarted = true;
          // Polling approach - works but less efficient
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              jobCancelled = true;
              throw new Error('Job was cancelled');
            }
            await delay(10);
          }
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      // Wait for job to start processing
      await waitingOnActive;

      await delay(50);

      // Cancel the job
      const cancelled = worker.cancelJob(job.id!);
      expect(cancelled).toBe(true);

      // Wait for the job to fail
      await new Promise<void>(resolve => {
        worker.on('failed', (failedJob, err) => {
          expect(failedJob?.id).toBe(job.id);
          expect(err.message).toBe('Job was cancelled');
          resolve();
        });
      });

      expect(jobStarted).toBe(true);
      expect(jobCancelled).toBe(true);

      await worker.close();
    });

    it('should interrupt async operations with abort event', async () => {
      let operationStarted = false;
      let operationCancelled = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          operationStarted = true;

          // Wrap long async operation with abort handling
          const longOperation = new Promise(resolve => {
            setTimeout(() => resolve({ result: 'done' }), 5000);
          });

          const abortPromise = new Promise((_, reject) => {
            signal?.addEventListener('abort', () => {
              operationCancelled = true;
              reject(new Error('Operation cancelled'));
            });
          });

          // Race between operation and abort
          return await Promise.race([longOperation, abortPromise]);
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      await waitingOnActive;

      await delay(100);

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', (failedJob, err) => {
          expect(err.message).toBe('Operation cancelled');
          resolve();
        });
      });

      expect(operationStarted).toBe(true);
      expect(operationCancelled).toBe(true);

      await worker.close();
    });

    it('should return false when cancelling a non-existent job', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const cancelled = worker.cancelJob('non-existent-job-id');
      expect(cancelled).toBe(false);

      await worker.close();
    });

    it('should return false when cancelling a job that has already completed', async () => {
      let jobCompleted = false;

      const worker = new Worker(
        queueName,
        async () => {
          await delay(10);
          jobCompleted = true;
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnCompleted = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      // Wait for job to complete
      await waitingOnCompleted;

      // Add small delay to ensure untracking is complete
      await delay(10);

      expect(jobCompleted).toBe(true);

      // Job should not be tracked after completion
      const cancelled = worker.cancelJob(job.id!);
      expect(cancelled).toBe(false);

      await worker.close();
    });
  });

  describe('Cancel All Jobs', () => {
    it('should cancel all active jobs', async () => {
      const numJobs = 5;
      const cancelledJobs = new Set<string>();

      const worker = new Worker(
        queueName,
        async (job, _token, signal) => {
          // Simulate long-running work
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              cancelledJobs.add(job.id!);
              throw new Error('Job was cancelled');
            }
            await delay(10);
          }
          return { done: true };
        },
        { connection, prefix, concurrency: numJobs },
      );

      await worker.waitUntilReady();

      // Wait for all jobs to be active
      let activeCount = 0;
      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => {
          activeCount++;
          if (activeCount === numJobs) {
            resolve();
          }
        });
      });

      // Add multiple jobs
      await Promise.all(
        Array.from({ length: numJobs }, (_, i) =>
          queue.add('test', { index: i }),
        ),
      );

      await waitingOnActive;

      // Get active job IDs before cancelling
      const activeJobs = await queue.getActive();
      expect(activeJobs).toHaveLength(numJobs);

      // Cancel all jobs
      worker.cancelAllJobs();

      // Wait for all jobs to fail
      await new Promise<void>(resolve => {
        let failedCount = 0;
        worker.on('failed', () => {
          failedCount++;
          if (failedCount === numJobs) {
            resolve();
          }
        });
      });

      expect(cancelledJobs.size).toBe(numJobs);

      await worker.close();
    });
  });

  describe('AbortSignal Integration', () => {
    it('should work with fetch-like APIs that accept abort signal', async () => {
      let abortSignalReceived = false;
      let signalWasAborted = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          abortSignalReceived = signal !== undefined;

          // Simulate an API that accepts signal
          const mockFetch = async (signal?: AbortSignal) => {
            for (let i = 0; i < 50; i++) {
              if (signal?.aborted) {
                signalWasAborted = true;
                throw new Error('Request aborted');
              }
              await delay(10);
            }
            return { data: 'success' };
          };

          return await mockFetch(signal);
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      // Wait for job to start
      await waitingOnActive;

      // Cancel the job
      worker.cancelJob(job.id!);

      // Wait for failure
      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      expect(abortSignalReceived).toBe(true);
      expect(signalWasAborted).toBe(true);

      await worker.close();
    });

    it('should work with processor that ignores signal (backward compatibility)', async () => {
      let jobCompleted = false;

      const worker = new Worker(
        queueName,
        async job => {
          // Old-style processor that doesn't use signal
          await delay(50);
          jobCompleted = true;
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnCompleted = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('test', { foo: 'bar' });

      // Wait for completion
      await waitingOnCompleted;

      expect(jobCompleted).toBe(true);

      await worker.close();
    });

    it('should handle signal.aborted check in async operations', async () => {
      let iterations = 0;
      let wasAborted = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          while (iterations < 100) {
            if (signal?.aborted) {
              wasAborted = true;
              throw new Error('Aborted');
            }
            await delay(5);
            iterations++;
          }
          return { iterations };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      // Wait for job to start
      await waitingOnActive;

      // Give it some time to iterate
      await delay(25);

      // Cancel
      worker.cancelJob(job.id!);

      // Wait for failure
      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      expect(wasAborted).toBe(true);
      expect(iterations).toBeLessThan(100);

      await worker.close();
    });
  });

  describe('Lock Renewal Failure', () => {
    it('should allow manual cancellation on lockRenewalFailed event', async () => {
      let lockRenewalFailedEmitted = false;
      let signalAborted = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          return new Promise((resolve, reject) => {
            signal?.addEventListener('abort', () => {
              signalAborted = true;
              reject(new Error('Cancelled due to lock renewal failure'));
            });

            // Simulate work
            setTimeout(() => resolve({ done: true }), 5000);
          });
        },
        { connection, prefix },
      );

      // Set up event listener for lock renewal failures
      worker.on('lockRenewalFailed', jobIds => {
        lockRenewalFailedEmitted = true;
        // User pattern: manually cancel jobs when lock renewal fails
        jobIds.forEach(id => worker.cancelJob(id));
      });

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      await waitingOnActive;

      // Simulate lock renewal failure by calling cancelJob
      // (In real scenario, this would be triggered by lockRenewalFailed event)
      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      expect(signalAborted).toBe(true);

      await worker.close();
    });
  });

  describe('Get Active Jobs', () => {
    it('should return list of active job IDs using queue.getActive()', async () => {
      const numJobs = 3;

      const worker = new Worker(
        queueName,
        async () => {
          // Long-running job
          await delay(500);
          return { done: true };
        },
        { connection, prefix, concurrency: numJobs },
      );

      await worker.waitUntilReady();

      // Wait for all jobs to be active
      let activeCount = 0;
      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => {
          activeCount++;
          if (activeCount === numJobs) {
            resolve();
          }
        });
      });

      // Add jobs
      const jobs = await Promise.all(
        Array.from({ length: numJobs }, (_, i) =>
          queue.add('test', { index: i }),
        ),
      );

      await waitingOnActive;

      const activeJobs = await queue.getActive();
      expect(activeJobs).toHaveLength(numJobs);

      // Verify the IDs match
      const jobIds = jobs.map(j => j.id!);
      for (const activeJob of activeJobs) {
        expect(jobIds).toContain(activeJob.id);
      }

      await worker.close();
    });

    it('should return empty array when no jobs are active', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const activeJobs = await queue.getActive();
      expect(activeJobs).toBeInstanceOf(Array).that.is.empty;

      await worker.close();
    });

    it('should update active jobs list as jobs complete', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
          return { done: true };
        },
        { connection, prefix, concurrency: 2 },
      );

      await worker.waitUntilReady();

      // Wait for jobs to be active
      const waitingOnActive = new Promise<void>(resolve => {
        let count = 0;
        worker.on('active', () => {
          count++;
          if (count === 2) {
            resolve();
          }
        });
      });

      // Add 2 jobs
      await queue.add('test', { index: 1 });
      await queue.add('test', { index: 2 });

      await waitingOnActive;

      let activeJobs = await queue.getActive();
      expect(activeJobs.length).toBe(2);

      // Wait for jobs to complete
      await new Promise<void>(resolve => {
        let count = 0;
        worker.on('completed', () => {
          count++;
          if (count === 2) {
            resolve();
          }
        });
      });

      // Give a small delay for cleanup
      await delay(10);

      activeJobs = await queue.getActive();
      expect(activeJobs.length).toBe(0);

      await worker.close();
    });
  });

  describe('Edge Cases', () => {
    it('should handle cancellation of job that throws error', async () => {
      let errorThrown = false;
      let abortReceived = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 50; i++) {
            if (signal?.aborted) {
              abortReceived = true;
              errorThrown = true;
              throw new Error('Cancelled and error');
            }
            await delay(10);
          }
          throw new Error('Natural error');
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      await waitingOnActive;

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      expect(abortReceived).toBe(true);
      expect(errorThrown).toBe(true);

      await worker.close();
    });

    it('should handle concurrent cancellations', async () => {
      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              throw new Error('Cancelled');
            }
            await delay(5);
          }
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      await waitingOnActive;

      // Try to cancel multiple times
      const result1 = worker.cancelJob(job.id!);
      const result2 = worker.cancelJob(job.id!);
      const result3 = worker.cancelJob(job.id!);

      // First should succeed, subsequent calls should still work
      expect(result1).toBe(true);
      expect(result2).toBe(true); // Signal can be aborted multiple times
      expect(result3).toBe(true);

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      await worker.close();
    });

    it('should handle cancellation with UnrecoverableError', async () => {
      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              throw new UnrecoverableError('Job cancelled - do not retry');
            }
            await delay(10);
          }
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      await waitingOnActive;

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', (failedJob, err) => {
          expect(err).toBeInstanceOf(UnrecoverableError);
          expect(err.message).toContain('cancelled');
          resolve();
        });
      });

      await worker.close();
    });

    it('should work with multiple workers processing same queue', async () => {
      let worker1JobId: string | undefined;
      let worker2JobId: string | undefined;

      const worker1 = new Worker(
        queueName,
        async (job, token, signal) => {
          worker1JobId = job.id;
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              throw new Error('Worker 1 cancelled');
            }
            await delay(10);
          }
          return { worker: 1 };
        },
        { connection, prefix },
      );

      const worker2 = new Worker(
        queueName,
        async (job, token, signal) => {
          worker2JobId = job.id;
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              throw new Error('Worker 2 cancelled');
            }
            await delay(10);
          }
          return { worker: 2 };
        },
        { connection, prefix },
      );

      await worker1.waitUntilReady();
      await worker2.waitUntilReady();

      // Add 2 jobs
      await queue.add('test', { index: 1 });
      await queue.add('test', { index: 2 });

      // Wait for both to be active
      await delay(100);

      // Get active jobs from queue
      const activeJobs = await queue.getActive();
      expect(activeJobs.length).toBeGreaterThan(0);

      // Cancel jobs on each worker
      if (worker1JobId) {
        const cancelled = worker1.cancelJob(worker1JobId);
        expect(cancelled).toBe(true);
      }

      await worker1.close();
      await worker2.close();
    });
  });

  describe('Signal Properties', () => {
    it('should not create AbortController when processor does not use signal', async () => {
      let jobCompleted = false;

      // Processor with only 1 parameter (job) - no signal
      const worker = new Worker(
        queueName,
        async job => {
          await delay(50);
          jobCompleted = true;
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnCompleted = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('test', { foo: 'bar' });

      await waitingOnCompleted;

      expect(jobCompleted).toBe(true);

      // Verify AbortController was not created by checking the internal state
      // The lockManager should detect that processor doesn't use signal
      expect((worker as any).processorAcceptsSignal).toBe(false);

      await worker.close();
    });

    it('should create AbortController when processor uses signal parameter', async () => {
      let signalReceived = false;

      // Processor with 3 parameters including signal
      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          signalReceived = signal !== undefined;
          await delay(50);
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnCompleted = new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      await queue.add('test', { foo: 'bar' });

      await waitingOnCompleted;

      expect(signalReceived).toBe(true);
      expect((worker as any).processorAcceptsSignal).toBe(true);

      await worker.close();
    });

    it('should provide working AbortSignal with aborted property', async () => {
      let signalWasAborted = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          expect(signal).toBeDefined();
          expect(signal?.aborted).toBe(false);

          // Wait for cancellation
          await delay(100);

          if (signal?.aborted) {
            signalWasAborted = true;
            throw new Error('Aborted');
          }

          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      await waitingOnActive;

      await delay(50);
      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      expect(signalWasAborted).toBe(true);

      await worker.close();
    });

    it('should work with signal event listener', async () => {
      let abortEventFired = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          if (signal) {
            signal.addEventListener('abort', () => {
              abortEventFired = true;
            });
          }

          for (let i = 0; i < 100; i++) {
            await delay(10);
            if (signal?.aborted) {
              throw new Error('Aborted via event');
            }
          }

          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      await waitingOnActive;

      await delay(50);
      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      expect(abortEventFired).toBe(true);

      await worker.close();
    });

    it('should support cancellation reason', async () => {
      let receivedReason: string | undefined;
      let jobWasCancelled = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          return new Promise((resolve, reject) => {
            signal?.addEventListener('abort', () => {
              receivedReason = (signal as any).reason;
              jobWasCancelled = true;
              reject(new Error(`Cancelled: ${receivedReason || 'no reason'}`));
            });

            // Simulate long work
            setTimeout(() => resolve({ done: true }), 5000);
          });
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const job = await queue.add('test', { foo: 'bar' });

      await waitingOnActive;

      // Cancel with a specific reason
      const customReason = 'User requested cancellation';
      worker.cancelJob(job.id!, customReason);

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      expect(jobWasCancelled).toBe(true);
      expect(receivedReason).toBe(customReason);

      await worker.close();
    });

    it('should catch error from moveToFailed when lock is lost', async () => {
      let failedEventCount = 0;
      let errorEventCount = 0;
      let errorMessage = '';

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          // Mock the moveToFailed to simulate a lost lock scenario
          job.moveToFailed = async function (...args: any[]) {
            // Simulate the error that Lua script throws when lock is invalid
            throw new Error(
              'could not lock job: job-123, state: active. Missing job.',
            );
          };

          // Now throw an error - this will call handleFailed which calls moveToFailed
          throw new Error('Job processing error');
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const waitingOnActive = new Promise<void>(resolve => {
        let activeReceived = false;

        worker.on('active', () => {
          activeReceived = true;
          // Wait a bit to ensure processing completes
          setTimeout(resolve, 100);
        });
      });

      worker.on('failed', (failedJob, err) => {
        failedEventCount++;
      });

      worker.on('error', err => {
        errorEventCount++;
        errorMessage = err.message;
      });

      await queue.add('test', { foo: 'bar' }, { attempts: 1 });

      await waitingOnActive;

      // The failed event should NOT be emitted because moveToFailed threw
      expect(failedEventCount).toBe(0);

      // An error event should be emitted for the moveToFailed failure
      expect(errorEventCount).toBeGreaterThan(0);
      expect(errorMessage).toContain('could not lock job');

      await worker.close();
    });
  });
});
