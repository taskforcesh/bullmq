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

describe('Job Cancellation - Advanced Scenarios', () => {
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

  describe('Cancellation with Retries', () => {
    it('should retry cancelled job when throwing regular Error', async () => {
      let attemptCount = 0;
      let cancelledAttempt = 0;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          attemptCount++;

          if (attemptCount === 1) {
            // Cancel on first attempt
            for (let i = 0; i < 50; i++) {
              if (signal?.aborted) {
                cancelledAttempt = attemptCount;
                throw new Error('Job cancelled on attempt 1');
              }
              await delay(10);
            }
          } else {
            // Should retry and succeed
            return { attempt: attemptCount, success: true };
          }
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' }, { attempts: 3 });

      // Wait for active
      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      // Cancel the first attempt
      worker.cancelJob(job.id!);

      // Should fail first, then retry and complete
      const failedPromise = new Promise<void>(resolve => {
        worker.on('failed', (failedJob, err) => {
          expect(failedJob?.id).toBe(job.id);
          expect(err.message).toContain('cancelled');
          resolve();
        });
      });

      const completedPromise = new Promise<void>(resolve => {
        worker.on('completed', (completedJob, result) => {
          expect(completedJob.id).toBe(job.id);
          expect(result.attempt).toBe(2);
          expect(result.success).toBe(true);
          resolve();
        });
      });

      await failedPromise;
      await completedPromise;

      expect(cancelledAttempt).toBe(1);
      expect(attemptCount).toBe(2);

      const finalJob = await queue.getJob(job.id!);
      expect(finalJob?.attemptsMade).toBe(2);

      await worker.close();
    });

    it('should NOT retry cancelled job when throwing UnrecoverableError', async () => {
      let attemptCount = 0;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          attemptCount++;

          for (let i = 0; i < 50; i++) {
            if (signal?.aborted) {
              throw new UnrecoverableError('Job cancelled - do not retry');
            }
            await delay(10);
          }
          return { success: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' }, { attempts: 3 });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', async (failedJob, err) => {
          expect(failedJob?.id).toBe(job.id);
          expect(err).toBeInstanceOf(UnrecoverableError);
          expect(err.message).toContain('do not retry');

          // Wait a bit to ensure no retry happens
          await delay(200);
          resolve();
        });
      });

      expect(attemptCount).toBe(1);

      const finalJob = await queue.getJob(job.id!);
      expect(finalJob?.attemptsMade).toBe(1);
      expect(finalJob?.finishedOn).toBeDefined();

      const state = await finalJob?.getState();
      expect(state).toBe('failed');

      await worker.close();
    });

    it('should handle cancellation on last retry attempt', async () => {
      let attemptCount = 0;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          attemptCount++;

          // Cancel only on the last attempt
          if (attemptCount === 3) {
            for (let i = 0; i < 50; i++) {
              if (signal?.aborted) {
                throw new Error('Cancelled on final attempt');
              }
              await delay(10);
            }
          } else {
            throw new Error('Failed attempt ' + attemptCount);
          }
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' }, { attempts: 3 });

      let failedCount = 0;
      const allFailed = new Promise<void>(resolve => {
        worker.on('failed', () => {
          failedCount++;
          if (failedCount === 3) {
            resolve();
          }
        });
      });

      // Wait for job to start on third attempt
      await delay(100);

      // Cancel on third attempt
      worker.cancelJob(job.id!);

      await allFailed;

      expect(attemptCount).toBe(3);
      expect(failedCount).toBe(3);

      const finalJob = await queue.getJob(job.id!);
      expect(finalJob?.attemptsMade).toBe(3);

      await worker.close();
    });
  });

  describe('Job State Transitions', () => {
    it('should move cancelled job to failed state', async () => {
      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              throw new Error('Cancelled');
            }
            await delay(10);
          }
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' }, { attempts: 1 });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      const stateBefore = await job.getState();
      expect(stateBefore).toBe('active');

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      await delay(10);

      const stateAfter = await job.getState();
      expect(stateAfter).toBe('failed');

      const updatedJob = await queue.getJob(job.id!);
      expect(updatedJob?.failedReason).toContain('Cancelled');

      await worker.close();
    });

    it('should track job state through QueueEvents', async () => {
      const events: string[] = [];

      queueEvents.on('active', ({ jobId }) => {
        events.push(`active:${jobId}`);
      });

      queueEvents.on('failed', ({ jobId }) => {
        events.push(`failed:${jobId}`);
      });

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              throw new UnrecoverableError('Cancelled');
            }
            await delay(10);
          }
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        queueEvents.on('failed', () => resolve());
      });

      expect(events).toContain(`active:${job.id}`);
      expect(events).toContain(`failed:${job.id}`);

      await worker.close();
    });
  });

  describe('Cancellation Timing', () => {
    it('should cancel job before it processes any data', async () => {
      // TODO: Move timeout to test options: { timeout: 6000 }
      let processingStarted = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          // Check signal immediately
          if (signal?.aborted) {
            throw new Error('Cancelled before processing');
          }

          processingStarted = true;
          await delay(100);
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      // Cancel immediately after adding (race condition test)
      let wasCancelled = false;
      const racePromise = new Promise<void>(resolve => {
        worker.on('active', async () => {
          worker.cancelJob(job.id!);
          wasCancelled = true;
          resolve();
        });
      });

      await racePromise;

      // Wait for either completion or failure
      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
        worker.on('completed', () => resolve());
      });

      expect(wasCancelled).toBe(true);

      await worker.close();
    });

    it('should cancel job in the middle of processing', async () => {
      let processedItems = 0;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              throw new Error(
                `Cancelled after processing ${processedItems} items`,
              );
            }
            processedItems++;
            await delay(5);
          }
          return { processedItems };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      // Wait for some processing
      await delay(50);

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', (failedJob, err) => {
          expect(err.message).toContain('Cancelled after processing');
          resolve();
        });
      });

      expect(processedItems).toBeGreaterThan(0);
      expect(processedItems).toBeLessThan(100);

      await worker.close();
    });

    it('should handle cancellation near completion', async () => {
      let almostComplete = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 10; i++) {
            await delay(10);
            if (i === 8) {
              almostComplete = true;
            }
            if (signal?.aborted) {
              throw new Error('Cancelled near completion');
            }
          }
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      // Wait until almost complete
      await delay(85);

      worker.cancelJob(job.id!);

      // Race between completion and cancellation
      await new Promise<void>(resolve => {
        worker.on('failed', () => {
          resolve();
        });
        worker.on('completed', () => {
          resolve();
        });
      });

      await worker.close();
    });
  });

  describe('Concurrency and Cancellation', () => {
    it('should cancel specific job among concurrent jobs', async () => {
      const jobStatuses = new Map<string, string>();

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              jobStatuses.set(job.id!, 'cancelled');
              throw new Error('Cancelled');
            }
            await delay(5);
          }
          jobStatuses.set(job.id!, 'completed');
          return { id: job.id };
        },
        { connection, prefix, concurrency: 3 },
      );

      await worker.waitUntilReady();

      // Add 3 jobs
      const jobs = await Promise.all([
        queue.add('test', { index: 1 }),
        queue.add('test', { index: 2 }),
        queue.add('test', { index: 3 }),
      ]);

      // Wait for all to be active
      let activeCount = 0;
      await new Promise<void>(resolve => {
        worker.on('active', () => {
          activeCount++;
          if (activeCount === 3) {
            resolve();
          }
        });
      });

      // Cancel only the middle job
      worker.cancelJob(jobs[1].id!);

      // Wait for 1 failure and 2 completions
      await new Promise<void>(resolve => {
        let completedCount = 0;
        let failedCount = 0;

        worker.on('completed', () => {
          completedCount++;
          if (completedCount === 2 && failedCount === 1) {
            resolve();
          }
        });

        worker.on('failed', () => {
          failedCount++;
          if (completedCount === 2 && failedCount === 1) {
            resolve();
          }
        });
      });

      expect(jobStatuses.get(jobs[0].id!)).toBe('completed');
      expect(jobStatuses.get(jobs[1].id!)).toBe('cancelled');
      expect(jobStatuses.get(jobs[2].id!)).toBe('completed');

      await worker.close();
    });

    it('should handle rapid cancellations with high concurrency', async () => {
      // TODO: Move timeout to test options: { timeout: 6000 }
      const concurrency = 10;
      const cancelledJobs = new Set<string>();
      const completedJobs = new Set<string>();

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              cancelledJobs.add(job.id!);
              throw new Error('Cancelled');
            }
            await delay(5);
          }
          completedJobs.add(job.id!);
          return { done: true };
        },
        { connection, prefix, concurrency },
      );

      await worker.waitUntilReady();

      // Add many jobs
      const jobs = await Promise.all(
        Array.from({ length: concurrency }, (_, i) =>
          queue.add('test', { index: i }),
        ),
      );

      // Wait for all to be active
      let activeCount = 0;
      await new Promise<void>(resolve => {
        worker.on('active', () => {
          activeCount++;
          if (activeCount === concurrency) {
            resolve();
          }
        });
      });

      // Cancel half of them rapidly
      const jobsToCancel = jobs.slice(0, 5);
      jobsToCancel.forEach(job => worker.cancelJob(job.id!));

      // Wait for all to finish (either completed or failed)
      await new Promise<void>(resolve => {
        let finishedCount = 0;
        const checkDone = () => {
          if (finishedCount === concurrency) {
            resolve();
          }
        };

        worker.on('completed', () => {
          finishedCount++;
          checkDone();
        });

        worker.on('failed', () => {
          finishedCount++;
          checkDone();
        });
      });

      expect(cancelledJobs.size).toBeGreaterThan(0);

      await worker.close();
    });
  });

  describe('Cancellation with Delayed Jobs', () => {
    it('should handle cancellation of job with backoff retry', async () => {
      let attemptCount = 0;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          attemptCount++;

          for (let i = 0; i < 50; i++) {
            if (signal?.aborted) {
              throw new Error('Cancelled');
            }
            await delay(10);
          }
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add(
        'test',
        { foo: 'bar' },
        { attempts: 3, backoff: { type: 'fixed', delay: 100 } },
      );

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      // Should be delayed for retry
      await delay(50);
      const state = await job.getState();
      expect(state).toBe('delayed');

      // Wait for retry
      await delay(100);

      await new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      expect(attemptCount).toBe(2);

      await worker.close();
    });
  });

  describe('Error Messages and Debugging', () => {
    it('should preserve error message from cancellation', async () => {
      const customMessage = 'User requested cancellation: operation timeout';

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              throw new Error(customMessage);
            }
            await delay(10);
          }
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' }, { attempts: 1 });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', async (failedJob, err) => {
          expect(err.message).toBe(customMessage);

          const updatedJob = await queue.getJob(failedJob!.id!);
          expect(updatedJob?.failedReason).toBe(customMessage);

          resolve();
        });
      });

      await worker.close();
    });

    it('should track stacktrace for cancelled jobs', async () => {
      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              const error = new Error('Job cancelled');
              throw error;
            }
            await delay(10);
          }
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' }, { attempts: 1 });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', async () => {
          const updatedJob = await queue.getJob(job.id!);
          expect(updatedJob?.stacktrace).toBeDefined();
          expect(updatedJob?.stacktrace).toBeInstanceOf(Array);
          expect(updatedJob?.stacktrace!.length).toBeGreaterThan(0);
          expect(updatedJob?.stacktrace![0]).toContain(
            'job_cancellation_advanced.test',
          );
          resolve();
        });
      });

      await worker.close();
    });
  });

  describe('Worker Lifecycle and Cancellation', () => {
    it('should handle cancellation during worker shutdown', async () => {
      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              throw new Error('Cancelled');
            }
            await delay(10);
          }
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      // Cancel job then immediately close worker
      worker.cancelJob(job.id!);
      const closePromise = worker.close();

      await closePromise;

      const state = await job.getState();
      expect(['failed', 'active']).toContain(state);
    });

    it('should not cancel jobs after worker is closed', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();
      await worker.close();

      // Try to cancel after close
      const result = worker.cancelJob('some-job-id');
      expect(result).toBe(false);
    });
  });

  describe('Complex Cancellation Patterns', () => {
    it('should support async cleanup when job is cancelled', async () => {
      let cleanupStarted = false;
      let cleanupCompleted = false;
      let resourceReleased = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          // Simulate acquiring a resource
          const resource = { id: 'resource-1', active: true };

          return new Promise(async (resolve, reject) => {
            // Event-based abort handling
            signal?.addEventListener('abort', async () => {
              try {
                cleanupStarted = true;

                // Perform async cleanup operations
                await delay(50); // Simulate async cleanup
                resource.active = false;

                // Release resource asynchronously
                await new Promise<void>(res => {
                  setTimeout(() => {
                    resourceReleased = true;
                    res();
                  }, 20);
                });

                cleanupCompleted = true;

                // Now reject after cleanup
                reject(new Error('Cancelled after cleanup'));
              } catch (cleanupError) {
                // Cleanup failed, but still cancel
                reject(new Error('Cleanup failed during cancellation'));
              }
            });

            // Simulate long work
            try {
              await delay(5000);
              resolve({ done: true });
            } catch (err) {
              reject(err);
            } finally {
              // Additional cleanup if needed
              if (resource.active) {
                resource.active = false;
              }
            }
          });
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      await delay(50);

      // Cancel the job
      worker.cancelJob(job.id!);

      // Wait for the job to fail after cleanup
      await new Promise<void>(resolve => {
        worker.on('failed', (failedJob, err) => {
          expect(err.message).toBe('Cancelled after cleanup');
          resolve();
        });
      });

      // Verify all cleanup steps completed
      expect(cleanupStarted).toBe(true);
      expect(cleanupCompleted).toBe(true);
      expect(resourceReleased).toBe(true);

      await worker.close();
    });

    it('should handle complex async cleanup with multiple resources', async () => {
      const cleanupLog: string[] = [];

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          const db = { connected: true };
          const cache = { connected: true };
          const fileHandle = { open: true };

          return new Promise(async (resolve, reject) => {
            // Event-based cleanup handler
            signal?.addEventListener('abort', async () => {
              try {
                cleanupLog.push('cancellation-detected');

                // Close database connection
                await delay(20);
                db.connected = false;
                cleanupLog.push('db-closed');

                // Clear cache
                await delay(20);
                cache.connected = false;
                cleanupLog.push('cache-cleared');

                // Close file handle
                await delay(20);
                fileHandle.open = false;
                cleanupLog.push('file-closed');

                reject(new Error('Gracefully cancelled'));
              } catch (err) {
                // Ensure cleanup even if error during cleanup
                if (db.connected) {
                  await delay(10);
                  db.connected = false;
                  cleanupLog.push('db-emergency-close');
                }
                reject(err);
              }
            });

            // Simulate long work
            try {
              await delay(5000);
              resolve({ success: true });
            } catch (err) {
              reject(err);
            }
          });
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      await delay(50);

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      // Verify cleanup happened in correct order
      expect(cleanupLog).toContain('cancellation-detected');
      expect(cleanupLog).toContain('db-closed');
      expect(cleanupLog).toContain('cache-cleared');
      expect(cleanupLog).toContain('file-closed');
      expect(cleanupLog).not.toContain('db-emergency-close');

      await worker.close();
    });

    it('should handle timeout during async cleanup', async () => {
      let cleanupAttempted = false;
      let cleanupTimedOut = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              cleanupAttempted = true;

              // Attempt cleanup with timeout
              const cleanupPromise = new Promise(resolve => {
                setTimeout(() => resolve('cleanup-done'), 200);
              });

              const timeoutPromise = new Promise(resolve => {
                setTimeout(() => resolve('timeout'), 100);
              });

              const result = await Promise.race([
                cleanupPromise,
                timeoutPromise,
              ]);

              if (result === 'timeout') {
                cleanupTimedOut = true;
                throw new Error('Cancelled - cleanup timeout');
              }

              throw new Error('Cancelled after cleanup');
            }
            await delay(10);
          }
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      await delay(50);

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', (failedJob, err) => {
          expect(err.message).toContain('cleanup timeout');
          resolve();
        });
      });

      expect(cleanupAttempted).toBe(true);
      expect(cleanupTimedOut).toBe(true);

      await worker.close();
    });

    it('should allow cleanup to check signal again (re-entrant cancellation)', async () => {
      let firstCheckTime = 0;
      let secondCheckTime = 0;
      let cleanupInterrupted = false;

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted && !firstCheckTime) {
              firstCheckTime = Date.now();

              // Start cleanup that also checks signal
              for (let j = 0; j < 50; j++) {
                if (signal?.aborted) {
                  secondCheckTime = Date.now();
                  cleanupInterrupted = true;
                  // Cleanup can also detect it's still cancelled
                  throw new Error('Cleanup interrupted - still cancelled');
                }
                await delay(10);
              }

              throw new Error('Cancelled after cleanup');
            }
            await delay(10);
          }
          return { done: true };
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      await delay(50);

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      expect(firstCheckTime).toBeGreaterThan(0);
      expect(secondCheckTime).toBeGreaterThan(0);
      expect(cleanupInterrupted).toBe(true);

      await worker.close();
    });

    it('should handle cancellation with progress updates', async () => {
      const progressUpdates: number[] = [];

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          for (let i = 0; i < 100; i++) {
            if (signal?.aborted) {
              throw new Error('Cancelled');
            }
            if (i % 10 === 0) {
              await job.updateProgress(i);
            }
            await delay(5);
          }
          return { done: true };
        },
        { connection, prefix },
      );

      queueEvents.on('progress', ({ jobId, data }) => {
        progressUpdates.push(data as number);
      });

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      await delay(50);

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBeLessThan(100);

      await worker.close();
    });

    it('should cancel job that makes external API calls', async () => {
      let apiCallStarted = false;
      let apiCallCompleted = false;

      const simulateApiCall = async (signal?: AbortSignal) => {
        apiCallStarted = true;
        for (let i = 0; i < 50; i++) {
          if (signal?.aborted) {
            throw new Error('API call aborted');
          }
          await delay(10);
        }
        apiCallCompleted = true;
        return { data: 'success' };
      };

      const worker = new Worker(
        queueName,
        async (job, token, signal) => {
          const result = await simulateApiCall(signal);
          return result;
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('active', () => resolve());
      });

      await delay(50);

      worker.cancelJob(job.id!);

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      expect(apiCallStarted).toBe(true);
      expect(apiCallCompleted).toBe(false);

      await worker.close();
    });
  });
});
