/**
 * Redis-only tests for `JobScheduler`.
 *
 * These exercise Redis-specific internals — raw `repeat`/metadata-hash keys
 * (`zadd`/`hset`/`hdel`/`exists`), manual lock-key deletion to simulate stalls,
 * and legacy repeatable-key formats — that have no backend-agnostic equivalent.
 * They live in a dedicated `*.redis.test.ts` suite excluded from the
 * cross-backend runs. The collision-detection logic, scheduler removal, and
 * stalled handling are also covered by backend-agnostic tests in
 * `job_scheduler.test.ts`; the tests here additionally assert the Redis
 * key-level behaviour.
 */
import { getRedisClient } from './utils/get-redis-client';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import * as sinon from 'sinon';
import { Queue, QueueEvents, Worker } from '../src/classes';
import { randomUUID, removeAllQueueData } from '../src/utils';
import { createTestConnection } from './utils/connection-factory';
import { IRedisClient } from '../src/interfaces';

const ONE_SECOND = 1000;
const ONE_MINUTE = 60 * ONE_SECOND;

describe('Job Scheduler (redis-only)', () => {
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;
  let clock: sinon.SinonFakeTimers;

  let connection: IRedisClient;
  beforeAll(async () => {
    connection = createTestConnection();
  });

  beforeEach(async () => {
    clock = sinon.useFakeTimers({
      shouldClearNativeTimers: true,
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    queueName = `test-${randomUUID()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queue.waitUntilReady();
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    clock.restore();
    try {
      await queue.close();
      await queueEvents.close();
      await removeAllQueueData(createTestConnection(), queueName);
    } catch (error) {
      // Ignore errors in cleanup (happens sometimes with Dragonfly in MacOS)
    }
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('when data does not exist in scheduler from old instances', () => {
    it('should repeat every 2 seconds reusing data from delayed job', async () => {
      // TODO: Move timeout to test options: { timeout: 10000 }
      const client = await getRedisClient(queue);
      const nextTick = 2 * ONE_SECOND + 100;

      const worker = new Worker(
        queueName,
        async () => {
          clock.tick(nextTick);
        },
        { autorun: false, connection, prefix },
      );
      const delayStub = sinon.stub(worker, 'delay').callsFake(async () => {});

      const date = new Date('2017-02-07T15:24:00.000Z');
      clock.setSystemTime(date);

      await queue.upsertJobScheduler(
        'test',
        { pattern: '*/2 * * * * *' },
        { data: { foo: 'bar' } },
      );
      await client!.hdel(`${prefix}:${queue.name}:repeat:test`, 'data');

      const scheduler = await queue.getJobScheduler('test');

      expect(scheduler).toEqual({
        iterationCount: 1,
        key: 'test',
        name: 'test',
        pattern: '*/2 * * * * *',
        offset: 0,
        next: 1486481042000,
      });

      clock.tick(nextTick);

      let prev: any;
      let counter = 0;

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async job => {
          try {
            expect(job.data).toEqual({ foo: 'bar' });
            if (prev) {
              expect(prev.timestamp).toBeLessThan(job.timestamp);
              expect(job.timestamp - prev.timestamp).toBeGreaterThanOrEqual(
                2000,
              );
            }
            prev = job;
            counter++;
            if (counter == 5) {
              resolve();
            }
          } catch (error) {
            reject(error);
          }
        });
      });

      worker.run();

      await completing;
      await worker.close();
      delayStub.restore();
    });
  });

  it('should be able to remove repeatable jobs by key', async () => {
    const client = await getRedisClient(queue);
    const repeat = { pattern: '*/2 * * * * *' };

    const createdJob = await queue.upsertJobScheduler('remove', repeat);
    const delayedCount1 = await queue.getJobCountByTypes('delayed');
    expect(delayedCount1).toBe(1);
    const job = await queue.getJob(createdJob!.id!);
    const repeatableJobs = await queue.getJobSchedulers();
    expect(repeatableJobs).toHaveLength(1);
    const existBeforeRemoval = await client.exists(
      `${prefix}:${queue.name}:repeat:${createdJob!.repeatJobKey!}`,
    );
    expect(existBeforeRemoval).toBe(1);
    const removed = await queue.removeJobScheduler(createdJob!.repeatJobKey!);
    const delayedCount = await queue.getJobCountByTypes('delayed');
    expect(delayedCount).toBe(0);
    const existAfterRemoval = await client.exists(
      `${prefix}:${queue.name}:repeat:${createdJob!.repeatJobKey!}`,
    );
    expect(existAfterRemoval).toBe(0);
    expect(job!.repeatJobKey).toBeDefined();
    expect(removed).toBe(true);
    const repeatableJobsAfterRemove = await queue.getJobSchedulers();
    expect(repeatableJobsAfterRemove).toHaveLength(0);
  });

  describe('when listing schedulers without hash data', () => {
    it('should raise a migration error for legacy repeatable keys', async () => {
      const client = await getRedisClient(queue);
      const next = Date.now() + ONE_MINUTE;
      const legacyKey = 'legacy-name:legacy-id:::*/5 * * * * *';

      await client.zadd(queue.toKey('repeat'), next, legacyKey);

      await expect(queue.getJobSchedulers()).rejects.toThrow(
        'Legacy repeatable job metadata is not supported in BullMQ v6',
      );
    });

    it('should ignore dangling scheduler references that are not legacy repeatable keys', async () => {
      const client = await getRedisClient(queue);
      const next = Date.now() + ONE_MINUTE;

      await client.zadd(queue.toKey('repeat'), next, 'missing-scheduler');

      await expect(queue.getJobSchedulers()).resolves.toEqual([]);
    });
  });

  describe('when processing a legacy repeatable job in v6', () => {
    it('should emit a migration error instead of silently skipping rescheduling', async () => {
      const date = new Date('2017-02-07 9:24:00');
      clock.setSystemTime(date);

      const scheduledJob = await queue.upsertJobScheduler('test-scheduler', {
        every: ONE_MINUTE,
      });
      const legacyKey = 'legacy-name:legacy-id:::*/5 * * * * *';
      const jobData = scheduledJob!.asJSON();
      jobData.repeatJobKey = legacyKey;

      const worker = new Worker(queueName, async () => {}, {
        autorun: false,
        connection,
        prefix,
      });
      await worker.waitUntilReady();

      const errors: Error[] = [];
      worker.on('error', err => {
        errors.push(err);
      });

      const errorPromise = new Promise<void>((resolve, reject) => {
        worker.once('error', err => {
          try {
            expect(err.message).toContain(
              'Failed to add repeatable job for next iteration',
            );
            expect(err.message).toContain(
              'Legacy repeatable job metadata is not supported in BullMQ v6',
            );
            expect(err.message).toContain('migrate-from-v5-to-v6');
            resolve();
          } catch (assertionError) {
            reject(assertionError);
          }
        });
      });

      const nextJob = await (worker as any).nextJobFromJobData(
        jobData,
        scheduledJob!.id!,
        'token',
      );

      expect(nextJob).toBeUndefined();
      await errorPromise;
      expect(errors).toHaveLength(1);
      await worker.close();
    });
  });

  describe('when repeatable job fails', () => {
    it('should not create a new delayed job if the failed job is stalled and moved back to wait', async () => {
      // Note, this test is expected to throw an exception like this:
      // "Error: Missing lock for job repeat:test:1486455840000. moveToFinished"
      const date = new Date('2017-02-07 9:24:00');
      clock.setSystemTime(date);

      const repeatOpts = {
        every: 2000,
      };

      const repeatableJob = await queue.upsertJobScheduler('test', repeatOpts);
      expect(repeatableJob).toBeTruthy();

      const waitingCount = await queue.getWaitingCount();
      expect(waitingCount).toBe(1);

      let resolveCompleting: () => void;
      const completingJob = new Promise<void>(resolve => {
        resolveCompleting = resolve;
      });

      let worker: Worker;
      const processing = new Promise<void>(resolve => {
        worker = new Worker(
          queueName,
          async () => {
            resolve();
            return completingJob;
          },
          {
            connection,
            prefix,
            skipLockRenewal: true,
            skipStalledCheck: true,
          },
        );
      });
      const delayStub = sinon.stub(worker!, 'delay').callsFake(async () => {});

      await processing;

      // force remove the lock
      const client = await getRedisClient(queue);
      const lockKey = `${prefix}:${queueName}:${repeatableJob!.id}:lock`;
      await client.del(lockKey);

      const stalledCheckerKey = `${prefix}:${queueName}:stalled-check`;
      await client.del(stalledCheckerKey);

      const scripts = (<any>worker!).backend;
      let [failed, stalled] = await scripts.moveStalledJobsToWait();

      await client.del(stalledCheckerKey);

      [failed, stalled] = await scripts.moveStalledJobsToWait();

      const waitingJobs = await queue.getWaiting();
      expect(waitingJobs.length).toBe(1);

      await clock.tick(500);

      resolveCompleting!();
      await worker!.close();

      await clock.tick(500);

      const delayedCount2 = await queue.getDelayedCount();
      expect(delayedCount2).toBe(1);

      let completedJobs = await queue.getCompleted();
      expect(completedJobs.length).toBe(0);

      const processing2 = new Promise<void>(resolve => {
        worker = new Worker(
          queueName,
          async () => {
            resolve();
          },
          {
            connection,
            prefix,
            skipLockRenewal: true,
            skipStalledCheck: true,
          },
        );
      });

      await processing2;

      await worker!.close();

      completedJobs = await queue.getCompleted();
      expect(completedJobs.length).toBe(1);

      const waitingJobs2 = await queue.getWaiting();
      expect(waitingJobs2.length).toBe(0);

      const delayedCount3 = await queue.getDelayedCount();
      expect(delayedCount3).toBe(1);
      delayStub.restore();
    });

    describe('when the scheduler has been removed', () => {
      it('should fail a stalled scheduler job after maxStalledCount', async () => {
        const date = new Date('2017-02-07 9:24:00');
        clock.setSystemTime(date);

        const schedulerJobId = 'test-scheduler';
        const repeatOpts = { every: 2000 };

        const repeatableJob = await queue.upsertJobScheduler(
          schedulerJobId,
          repeatOpts,
        );
        expect(repeatableJob).toBeTruthy();

        const waitingCount = await queue.getWaitingCount();
        expect(waitingCount).toBe(1);

        let resolveCompleting: () => void;
        const completingJob = new Promise<void>(resolve => {
          resolveCompleting = resolve;
        });

        let worker: Worker;
        const processing = new Promise<void>(resolve => {
          worker = new Worker(
            queueName,
            async () => {
              resolve();
              return completingJob;
            },
            {
              connection,
              prefix,
              skipLockRenewal: true,
              skipStalledCheck: true,
              maxStalledCount: 0,
            },
          );
        });
        const delayStub = sinon
          .stub(worker!, 'delay')
          .callsFake(async () => {});

        await processing;

        // Force remove the lock so the job appears stalled
        const client = await getRedisClient(queue);
        const lockKey = `${prefix}:${queueName}:${repeatableJob!.id}:lock`;
        await client.del(lockKey);

        // Remove the scheduler — the job's rjk no longer points to an existing scheduler
        await queue.removeJobScheduler(schedulerJobId);

        const stalledCheckerKey = `${prefix}:${queueName}:stalled-check`;
        await client.del(stalledCheckerKey);

        const scripts = (<any>worker!).backend;

        // First call: marks the active job as stalled
        await scripts.moveStalledJobsToWait();

        await client.del(stalledCheckerKey);

        // Second call: stalledCount = 1 which exceeds maxStalledCount = 0, and since
        // the scheduler no longer exists the job is NOT treated as repeatable.
        // The Lua script sets deferredFailure on the job and moves it back to wait.
        await scripts.moveStalledJobsToWait();

        const waitingJobs = await queue.getWaiting();
        expect(waitingJobs.length).toBe(1);

        // Verify deferredFailure has been stamped onto the job
        const stalledJob = await queue.getJob(repeatableJob!.id!);
        expect(stalledJob!.deferredFailure).toBe(
          'job stalled more than allowable limit',
        );

        resolveCompleting!();
        await worker!.close();

        // A new worker should pick the job up and immediately fail it
        // because deferredFailure is set (UnrecoverableError path in worker.ts)
        const failedPromise = new Promise<void>((resolve, reject) => {
          worker = new Worker(
            queueName,
            async () => {
              reject(
                new Error(
                  'processor should not be called for a deferred-failed job',
                ),
              );
            },
            {
              connection,
              prefix,
              skipLockRenewal: true,
              skipStalledCheck: true,
              maxStalledCount: 0,
            },
          );
          worker.on('failed', (_job, err) => {
            try {
              expect(err.message).toBe('job stalled more than allowable limit');
              resolve();
            } catch (assertionError) {
              reject(assertionError);
            }
          });
        });

        await failedPromise;
        await worker!.close();

        const failedJobs = await queue.getFailed();
        expect(failedJobs.length).toBe(1);
        expect(failedJobs[0].failedReason).toBe(
          'job stalled more than allowable limit',
        );

        delayStub.restore();
      });
    });
  });

  describe('collision detection', () => {
    it('should handle collision detection correctly for concurrent scheduler operations', async () => {
      // Create a manual test using the lower-level API to simulate concurrent access
      // This test verifies our collision detection works at the script level

      // First create a job that will be "active" (simulated by creating the job key)
      const client = await getRedisClient(queue);
      const now = Date.now();
      const testJobId = `repeat:test-collision:${now}`;
      const testJobKey = `${queue.keys['']}${testJobId}`;

      // Simulate an existing job by creating its key
      await client.hset(testJobKey, { id: testJobId, data: '{}' });

      try {
        // Now try to create a job scheduler that would collide with this job ID
        await (queue as any).backend.addJobScheduler(
          'test-collision',
          now, // Same timestamp
          '{}',
          {},
          {
            name: 'test-job', // Include the required name field
            pattern: '0 0 * * * *',
          }, // pattern-based
          {},
        );

        // If we get here, the collision wasn't detected
        expect.fail(
          'Expected SchedulerJobIdCollision error but none was thrown',
        );
      } catch (error) {
        expect(error.message).toContain('job ID already exists');
      } finally {
        // Clean up
        await client.del(testJobKey);
      }
    });

    it('should handle collision detection for every-based schedulers', async () => {
      const date = new Date('2017-02-07T09:24:00.000+05:30');
      clock.setSystemTime(date);

      // Create a manual test for every-based scheduler collision
      const client = await getRedisClient(queue);
      const now = Date.now();
      const every = 1000; // 1 second
      const testJobId = `repeat:test-every-collision:${now}`;
      const nextSlotJobId = `repeat:test-every-collision:${now + every}`;

      // Simulate existing jobs in both current and next slots
      await client.hset(`${queue.keys['']}${testJobId}`, { id: testJobId });
      await client.hset(`${queue.keys['']}${nextSlotJobId}`, {
        id: nextSlotJobId,
      });

      try {
        // Try to create a job scheduler that would collide
        await (queue as any).backend.addJobScheduler(
          'test-every-collision',
          now, // Same timestamp as existing job
          '{}',
          {},
          {
            name: 'test-job', // Include the required name field
            every,
          }, // every-based
          {},
        );

        expect.fail('Expected SchedulerJobSlotsBusy error but none was thrown');
      } catch (error) {
        expect(error.message).toContain(
          'current and next time slots already have jobs',
        );
      } finally {
        // Clean up
        await client.del(`${queue.keys['']}${testJobId}`);
        await client.del(`${queue.keys['']}${nextSlotJobId}`);
      }
    });
  });

  describe('when job scheduler id contains 5 or more colon segments', () => {
    it('should NOT misclassify a legacy repeatable key with 5+ segments as a scheduler', async () => {
      // Legacy repeatable keys are written directly to the shared `repeat`
      // ZSET (no per-id metadata hash with `ic`). The discriminator must
      // distinguish them from new-style scheduler ids regardless of how
      // many colon segments the legacy key contains.
      const client = await getRedisClient(queue);
      const next = Date.now() + ONE_MINUTE;
      const legacyKey = 'legacy-name:legacy-id:::*/5 * * * * *';
      expect(legacyKey.split(':').length).toBeGreaterThanOrEqual(5);

      // Mirror what addRepeatableJob-2.lua does for legacy entries: only a
      // ZADD on the shared `repeat` set, no `ic` field on the metadata
      // hash. (We add a `name` field to mirror legacy storeRepeatableJob,
      // but crucially do NOT set `ic`.)
      await client.zadd(queue.toKey('repeat'), next, legacyKey);
      await client.hset(
        `${queue.toKey('repeat')}:${legacyKey}`,
        'name',
        'legacy-name',
      );

      const jobScheduler = await queue.jobScheduler;
      const isScheduler = await jobScheduler.isJobScheduler(legacyKey);
      expect(isScheduler).toBe(false);
    });
  });
});
