import { default as IORedis } from 'ioredis';
import { v4 } from 'uuid';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { Job, Queue, QueueEvents, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('deduplication', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  // TODO: Move timeout to test options: { timeout: 8000 }
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
    await queue.waitUntilReady();
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

  describe('when job is debounced when added again with same debounce id', () => {
    describe('when ttl is provided', () => {
      it('used a fixed time period and emits debounced event', async () => {
        const testName = 'test';

        const job = await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1', ttl: 2000 } },
        );

        let debouncedCounter = 0;
        // eslint-disable-next-line prefer-const
        let secondJob: Job;
        queueEvents.on('debounced', ({ jobId, debounceId }) => {
          if (debouncedCounter > 1) {
            expect(jobId).toBe(secondJob.id);
            expect(debounceId).toBe('a1');
          } else {
            expect(jobId).toBe(job.id);
            expect(debounceId).toBe('a1');
          }
          debouncedCounter++;
        });

        await delay(1000);
        await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1', ttl: 2000 } },
        );
        await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1', ttl: 2000 } },
        );
        await delay(1100);
        secondJob = await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1', ttl: 2000 } },
        );
        await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1', ttl: 2000 } },
        );
        await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1', ttl: 2000 } },
        );
        await delay(100);

        expect(debouncedCounter).toBe(4);
      });

      describe('when removing debounced job', () => {
        it('removes debounce key', async () => {
          const testName = 'test';

          const job = await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1', ttl: 2000 } },
          );

          let debouncedCounter = 0;
          queueEvents.on('debounced', ({ jobId }) => {
            debouncedCounter++;
          });
          await job.remove();

          await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1', ttl: 2000 } },
          );
          await delay(1000);
          await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1', ttl: 2000 } },
          );
          await delay(1100);
          const secondJob = await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1', ttl: 2000 } },
          );
          await secondJob.remove();

          await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1', ttl: 2000 } },
          );
          await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1', ttl: 2000 } },
          );
          await delay(100);

          expect(debouncedCounter).toBe(2);
        });

        describe('when manual removal on a debounced job in finished state', () => {
          it('does not remove debounced key', async () => {
            const testName = 'test';

            const job = await queue.add(
              testName,
              { foo: 'bar' },
              { debounce: { id: 'a1', ttl: 200 } },
            );

            const worker = new Worker(
              queueName,
              async () => {
                await delay(200);
              },
              {
                autorun: false,
                connection,
                prefix,
              },
            );

            await worker.waitUntilReady();

            const completion = new Promise<void>(resolve => {
              worker.once('completed', () => {
                resolve();
              });
            });

            worker.run();

            await completion;

            let deduplicatedCounter = 0;
            const deduplication = new Promise<void>(resolve => {
              queueEvents.on('debounced', () => {
                deduplicatedCounter++;
                if (deduplicatedCounter == 1) {
                  resolve();
                }
              });
            });

            await queue.add(
              testName,
              { foo: 'bar' },
              { debounce: { id: 'a1', ttl: 200 } },
            );

            await job.remove();

            await queue.add(
              testName,
              { foo: 'bar' },
              { debounce: { id: 'a1', ttl: 200 } },
            );

            await deduplication;

            expect(deduplicatedCounter).toBe(1);
            await worker.close();
          });
        });
      });
    });

    describe('when ttl is not provided', () => {
      it('waits until job is finished before removing debounce key', async () => {
        const testName = 'test';

        const worker = new Worker(
          queueName,
          async () => {
            await delay(100);
            await queue.add(
              testName,
              { foo: 'bar' },
              { debounce: { id: 'a1' } },
            );
            await delay(100);
            await queue.add(
              testName,
              { foo: 'bar' },
              { debounce: { id: 'a1' } },
            );
            await delay(100);
          },
          {
            autorun: false,
            connection,
            prefix,
          },
        );
        await worker.waitUntilReady();

        let debouncedCounter = 0;

        const completing = new Promise<void>(resolve => {
          queueEvents.once('completed', ({ jobId }) => {
            expect(jobId).toBe('1');
            resolve();
          });

          queueEvents.on('debounced', ({ jobId }) => {
            debouncedCounter++;
          });
        });

        worker.run();

        await queue.add(testName, { foo: 'bar' }, { debounce: { id: 'a1' } });

        await completing;

        const secondJob = await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1' } },
        );

        const count = await queue.getJobCountByTypes();

        expect(count).toEqual(2);

        expect(debouncedCounter).toBe(2);
        expect(secondJob.id).toBe('4');
        await worker.close();
      });

      describe('when removing debounced job', () => {
        it('removes debounce key', async () => {
          const testName = 'test';

          const job = await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1' } },
          );

          let debouncedCounter = 0;
          const debouncing = new Promise<void>(resolve => {
            queueEvents.on('debounced', () => {
              debouncedCounter++;
              if (debouncedCounter == 2) {
                resolve();
              }
            });
          });

          await job.remove();

          await queue.add(testName, { foo: 'bar' }, { debounce: { id: 'a1' } });

          await queue.add(testName, { foo: 'bar' }, { debounce: { id: 'a1' } });
          await delay(100);
          const secondJob = await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1' } },
          );
          await secondJob.remove();
          await debouncing;

          expect(debouncedCounter).toBe(2);
        });
      });
    });
  });

  describe('when job is deduplicated when added again with same debounce id', () => {
    it('emits deduplicated event', async () => {
      const testName = 'test';
      const dedupId = 'dedupId';

      const waitingEvent = new Promise<void>((resolve, reject) => {
        queueEvents.once(
          'deduplicated',
          async ({ jobId, deduplicationId, deduplicatedJobId }) => {
            try {
              const job = await queue.getJob(jobId);
              expect(job).toBeDefined();
              expect(jobId).toBe('a1');
              expect(deduplicationId).toBe(dedupId);

              const deduplicatedJob = await queue.getJob(deduplicatedJobId);
              expect(deduplicatedJob).toBeUndefined();
              expect(deduplicatedJobId).toBe('a2');
              resolve();
            } catch (error) {
              reject(error);
            }
          },
        );
      });

      await queue.add(
        testName,
        { foo: 'bar' },
        { jobId: 'a1', deduplication: { id: dedupId } },
      );
      await queue.add(
        testName,
        { foo: 'bar' },
        { jobId: 'a2', deduplication: { id: dedupId } },
      );

      await waitingEvent;
    });

    describe('when removing deduplication key', () => {
      it('should stop deduplication', async () => {
        const testName = 'test';
        const deduplicationId = 'dedupId';
        const worker = new Worker(
          queueName,
          async job => {
            await queue.removeDeduplicationKey(job.deduplicationId!);
            await delay(100);
          },
          { autorun: false, connection, prefix },
        );
        await worker.waitUntilReady();

        const completing = new Promise<void>((resolve, reject) => {
          worker.on('completed', job => {
            try {
              expect(job.deduplicationId).toBe(deduplicationId);
              if (job.id === 'a2') {
                resolve();
              }
            } catch (error) {
              reject(error);
            }
          });
        });
        worker.run();

        await queue.add(
          testName,
          { foo: 'bar' },
          { jobId: 'a1', deduplication: { id: deduplicationId } },
        );
        await delay(25);
        await queue.add(
          testName,
          { foo: 'bar' },
          { jobId: 'a2', deduplication: { id: deduplicationId } },
        );

        await completing;
        await worker.close();
      });

      describe('when using removeDeduplicationKey from job instance', () => {
        describe('when job id is still present inside deduplication key', () => {
          it('should stop deduplication', async () => {
            const testName = 'test';
            const deduplicationId = 'dedupId';
            const worker = new Worker(
              queueName,
              async job => {
                const isDeduplicationKeyRemoved =
                  await job.removeDeduplicationKey();
                expect(isDeduplicationKeyRemoved).toBe(true);
                await delay(100);
              },
              { autorun: false, connection, prefix },
            );
            await worker.waitUntilReady();

            let completedCounter = 0;
            const completing = new Promise<void>((resolve, reject) => {
              worker.on('completed', job => {
                try {
                  completedCounter++;
                  expect(job.deduplicationId).toBe(deduplicationId);
                  if (job.id === 'a2') {
                    resolve();
                  }
                } catch (error) {
                  reject(error);
                }
              });
            });
            worker.run();

            await queue.add(
              testName,
              { foo: 'bar' },
              { jobId: 'a1', deduplication: { id: deduplicationId } },
            );
            await delay(25);
            await queue.add(
              testName,
              { foo: 'bar' },
              { jobId: 'a2', deduplication: { id: deduplicationId } },
            );

            await completing;
            expect(completedCounter).toBe(2);

            await worker.close();
          });
        });

        describe('when job id is not present inside deduplication key', () => {
          it('should not stop deduplication', async () => {
            const testName = 'test';
            const deduplicationId = 'dedupId';
            const worker = new Worker(
              queueName,
              async job => {
                await delay(200);
                const isDeduplicationKeyRemoved =
                  await job.removeDeduplicationKey();
                expect(isDeduplicationKeyRemoved).toBe(false);
              },
              { autorun: false, connection, prefix },
            );
            await worker.waitUntilReady();

            let completedCounter = 0;
            const completing = new Promise<void>((resolve, reject) => {
              worker.on('completed', job => {
                try {
                  completedCounter++;
                  expect(job.deduplicationId).toBe(deduplicationId);
                  if (job.id === 'a2') {
                    resolve();
                  }
                } catch (error) {
                  reject(error);
                }
              });
            });
            worker.run();

            await queue.add(
              testName,
              { foo: 'bar' },
              { jobId: 'a1', deduplication: { id: deduplicationId, ttl: 100 } },
            );
            await delay(105);
            await queue.add(
              testName,
              { foo: 'bar' },
              { jobId: 'a2', deduplication: { id: deduplicationId, ttl: 100 } },
            );

            await completing;
            expect(completedCounter).toBe(2);

            await worker.close();
          });
        });
      });
    });

    describe('when ttl is provided', () => {
      it('used a fixed time period and emits debounced event', async () => {
        const testName = 'test';

        const job = await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1', ttl: 2000 } },
        );

        let deduplicatedCounter = 0;
        // eslint-disable-next-line prefer-const
        let secondJob: Job;
        queueEvents.on('deduplicated', ({ jobId, deduplicationId }) => {
          if (deduplicatedCounter > 1) {
            expect(jobId).toBe(secondJob.id);
            expect(deduplicationId).toBe('a1');
          } else {
            expect(jobId).toBe(job.id);
            expect(deduplicationId).toBe('a1');
          }
          deduplicatedCounter++;
        });

        await delay(1000);
        await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1', ttl: 2000 } },
        );
        await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1', ttl: 2000 } },
        );
        await delay(1100);
        secondJob = await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1', ttl: 2000 } },
        );
        await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1', ttl: 2000 } },
        );
        await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1', ttl: 2000 } },
        );
        await delay(100);

        expect(deduplicatedCounter).toBe(4);
      });

      describe('when removing deduplicated job', () => {
        it('removes deduplication key', async () => {
          const testName = 'test';

          const job = await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1', ttl: 2000 } },
          );

          let deduplicatedCounter = 0;
          queueEvents.on('deduplicated', ({ jobId }) => {
            deduplicatedCounter++;
          });
          await job.remove();

          await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1', ttl: 2000 } },
          );
          await delay(1000);
          await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1', ttl: 2000 } },
          );
          await delay(1100);
          const secondJob = await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1', ttl: 2000 } },
          );
          await secondJob.remove();

          await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1', ttl: 2000 } },
          );
          await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1', ttl: 2000 } },
          );
          await delay(100);

          expect(deduplicatedCounter).toBe(2);
        });
      });

      describe('when extend is provided as true', () => {
        it('resets ttl', async () => {
          const testName = 'test';

          const worker = new Worker(
            queueName,
            async () => {
              await delay(100);
            },
            {
              autorun: false,
              connection,
              prefix,
            },
          );
          await worker.waitUntilReady();

          let deduplicatedCounter = 0;

          const completing = new Promise<void>(resolve => {
            worker.once('completed', job => {
              expect(job.id).toBe('1');
              expect(job.data.foo).toBe('bar');
              resolve();
            });

            queueEvents.on('deduplicated', ({ jobId }) => {
              deduplicatedCounter++;
            });
          });

          worker.run();

          await queue.add(
            testName,
            { foo: 'bar' },
            {
              deduplication: { id: 'a1', ttl: 500, extend: true },
              delay: 500,
            },
          );

          await delay(250);

          await queue.add(
            testName,
            { foo: 'baz' },
            {
              deduplication: { id: 'a1', ttl: 500, extend: true },
              delay: 500,
            },
          );

          await delay(250);

          await queue.add(
            testName,
            { foo: 'bax' },
            {
              deduplication: { id: 'a1', ttl: 500, extend: true },
              delay: 500,
            },
          );

          await completing;

          const count = await queue.getJobCountByTypes();

          expect(count).toEqual(1);

          expect(deduplicatedCounter).toBe(2);
          await worker.close();
        });
      });

      describe('when replace is provided as true', () => {
        it('removes last job if it is in delayed state', async () => {
          const testName = 'test';
          const deduplicationId = 'a1';

          const worker = new Worker(
            queueName,
            async () => {
              await delay(100);
            },
            {
              autorun: false,
              connection,
              prefix,
            },
          );
          await worker.waitUntilReady();

          let deduplicatedCounter = 0;

          const completing = new Promise<void>(resolve => {
            worker.once('completed', job => {
              expect(job.id).toBe('2');
              expect(job.data.foo).toBe('baz');
              resolve();
            });

            queueEvents.on('deduplicated', ({ jobId }) => {
              deduplicatedCounter++;
            });
          });

          worker.run();

          await queue.add(
            testName,
            { foo: 'bar' },
            {
              deduplication: { id: deduplicationId, ttl: 500, replace: true },
              delay: 500,
            },
          );

          await delay(250);

          const job2 = await queue.add(
            testName,
            { foo: 'baz' },
            {
              deduplication: { id: deduplicationId, ttl: 500, replace: true },
              delay: 500,
            },
          );

          const deduplicationJobId =
            await queue.getDeduplicationJobId(deduplicationId);
          expect(deduplicationJobId).toBe(job2.id);

          await delay(300);

          const job3 = await queue.add(
            testName,
            { foo: 'bax' },
            {
              deduplication: { id: deduplicationId, ttl: 500, replace: true },
              delay: 500,
            },
          );

          const deduplicationJobId2 =
            await queue.getDeduplicationJobId(deduplicationId);
          expect(deduplicationJobId2).toBe(job3.id);

          await completing;

          const count = await queue.getJobCountByTypes();

          expect(count).toEqual(2);

          expect(deduplicatedCounter).toBe(1);
          await worker.close();
        });
      });

      describe('when extend is provided as true', () => {
        it('resets ttl', async () => {
          const testName = 'test';
          const deduplicationId = 'a1';

          const worker = new Worker(
            queueName,
            async () => {
              await delay(100);
            },
            {
              autorun: false,
              connection,
              prefix,
            },
          );
          await worker.waitUntilReady();

          let deduplicatedCounter = 0;

          const completing = new Promise<void>(resolve => {
            worker.once('completed', job => {
              expect(job.id).toBe('1');
              expect(job.data.foo).toBe('bar');
              resolve();
            });

            queueEvents.on('deduplicated', ({ jobId }) => {
              deduplicatedCounter++;
            });
          });

          worker.run();

          const job1 = await queue.add(
            testName,
            { foo: 'bar' },
            {
              deduplication: {
                id: deduplicationId,
                extend: true,
                ttl: 500,
              },
            },
          );

          await delay(250);

          await queue.add(
            testName,
            { foo: 'baz' },
            {
              deduplication: {
                id: deduplicationId,
                extend: true,
                ttl: 500,
              },
            },
          );

          const deduplicationJobId =
            await queue.getDeduplicationJobId(deduplicationId);
          expect(deduplicationJobId).toBe(job1.id);

          await delay(250);

          const job3 = await queue.add(
            testName,
            { foo: 'bax' },
            {
              deduplication: {
                id: deduplicationId,
                extend: true,
                ttl: 500,
              },
            },
          );

          const deduplicationJobId2 =
            await queue.getDeduplicationJobId(deduplicationId);
          expect(deduplicationJobId2).toBe(job3.id);

          await completing;

          const count = await queue.getJobCountByTypes();

          expect(count).toEqual(1);

          expect(deduplicatedCounter).toBe(2);
          await worker.close();
        });
      });

      describe('when extend and replace options are provided as true', () => {
        it('resets ttl and removes last job if it is in delayed state', async () => {
          const testName = 'test';
          const deduplicationId = 'a1';

          const worker = new Worker(
            queueName,
            async () => {
              await delay(100);
            },
            {
              autorun: false,
              connection,
              prefix,
            },
          );
          await worker.waitUntilReady();

          let deduplicatedCounter = 0;

          const completing = new Promise<void>(resolve => {
            worker.once('completed', job => {
              expect(job.id).toBe('10');
              expect(job.data.foo).toBe(9);
              resolve();
            });

            queueEvents.on('deduplicated', ({ jobId }) => {
              deduplicatedCounter++;
            });
          });

          worker.run();

          const jobs: Job[] = [];
          for (let i = 0; i < 10; i++) {
            const job = await queue.add(
              testName,
              { foo: i },
              {
                deduplication: {
                  id: deduplicationId,
                  ttl: 500,
                  extend: true,
                  replace: true,
                },
                delay: 500,
              },
            );
            jobs.push(job);
            await delay(25);
          }

          const deduplicationJobId =
            await queue.getDeduplicationJobId(deduplicationId);
          expect(deduplicationJobId).toBe(jobs[jobs.length - 1].id);

          await completing;

          const count = await queue.getJobCountByTypes();

          expect(count).toEqual(1);

          expect(deduplicatedCounter).toBe(9);
          await worker.close();
        });
      });
    });

    describe('when ttl is not provided', () => {
      it('waits until job is finished before removing debounce key', async () => {
        const testName = 'test';

        const worker = new Worker(
          queueName,
          async () => {
            await delay(100);
            await queue.add(
              testName,
              { foo: 'bar' },
              { deduplication: { id: 'a1' } },
            );
            await delay(100);
            await queue.add(
              testName,
              { foo: 'bar' },
              { deduplication: { id: 'a1' } },
            );
            await delay(100);
          },
          {
            autorun: false,
            connection,
            prefix,
          },
        );
        await worker.waitUntilReady();

        let deduplicatedCounter = 0;

        const completing = new Promise<void>(resolve => {
          queueEvents.once('completed', ({ jobId }) => {
            expect(jobId).toBe('1');
            resolve();
          });

          queueEvents.on('deduplicated', ({ jobId }) => {
            deduplicatedCounter++;
          });
        });

        worker.run();

        await queue.add(testName, { foo: 'bar' }, { debounce: { id: 'a1' } });

        await completing;

        const secondJob = await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1' } },
        );

        const count = await queue.getJobCountByTypes();

        expect(count).toEqual(2);

        expect(deduplicatedCounter).toBe(2);
        expect(secondJob.id).toBe('4');
        await worker.close();
      });

      describe('when replace is provided as true', () => {
        it('removes last job if it is in delayed state', async () => {
          const testName = 'test';
          const deduplicationId = 'a1';

          const worker = new Worker(
            queueName,
            async () => {
              await delay(250);
            },
            {
              autorun: false,
              connection,
              prefix,
            },
          );
          await worker.waitUntilReady();

          let deduplicatedCounter = 0;

          const completing = new Promise<void>(resolve => {
            worker.once('completed', job => {
              expect(job.id).toBe('2');
              expect(job.data.foo).toBe('baz');
              resolve();
            });

            queueEvents.on('deduplicated', ({ jobId }) => {
              deduplicatedCounter++;
            });
          });

          worker.run();

          await queue.add(
            testName,
            { foo: 'bar' },
            {
              deduplication: { id: deduplicationId, replace: true },
              delay: 500,
            },
          );

          await delay(150);

          const job2 = await queue.add(
            testName,
            { foo: 'baz' },
            {
              deduplication: { id: deduplicationId, replace: true },
              delay: 250,
            },
          );

          const deduplicationJobId =
            await queue.getDeduplicationJobId(deduplicationId);
          expect(deduplicationJobId).toBe(job2.id);

          await delay(400);

          const job3 = await queue.add(
            testName,
            { foo: 'bax' },
            {
              deduplication: { id: deduplicationId, replace: true },
              delay: 500,
            },
          );

          const deduplicationJobId2 =
            await queue.getDeduplicationJobId(deduplicationId);
          expect(deduplicationJobId2).toBe(job3.id);

          await completing;

          const count = await queue.getJobCountByTypes();

          expect(count).toEqual(1);

          expect(deduplicatedCounter).toBe(1);
          await worker.close();
        });
      });

      describe('when removing deduplicated job', () => {
        it('removes deduplication key', async () => {
          const testName = 'test';

          const job = await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1' } },
          );

          let deduplicatedCounter = 0;
          const deduplication = new Promise<void>(resolve => {
            queueEvents.on('deduplicated', () => {
              deduplicatedCounter++;
              if (deduplicatedCounter == 2) {
                resolve();
              }
            });
          });

          await job.remove();

          await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1' } },
          );

          await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1' } },
          );
          await delay(100);
          const secondJob = await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1' } },
          );
          await secondJob.remove();
          await deduplication;

          expect(deduplicatedCounter).toBe(2);
        });

        describe('when manual removal on a deduplicated job in finished state', () => {
          it('does not remove deduplication key', async () => {
            const testName = 'test';

            const job = await queue.add(
              testName,
              { foo: 'bar' },
              { deduplication: { id: 'a1' } },
            );

            const worker = new Worker(
              queueName,
              async () => {
                await delay(100);
              },
              {
                autorun: false,
                connection,
                prefix,
              },
            );

            await worker.waitUntilReady();

            const completion = new Promise<void>(resolve => {
              worker.once('completed', () => {
                resolve();
              });
            });

            worker.run();

            await completion;

            let deduplicatedCounter = 0;
            const deduplication = new Promise<void>(resolve => {
              queueEvents.on('deduplicated', () => {
                deduplicatedCounter++;
                if (deduplicatedCounter == 1) {
                  resolve();
                }
              });
            });

            await queue.add(
              testName,
              { foo: 'bar' },
              { deduplication: { id: 'a1' } },
            );

            await job.remove();

            await queue.add(
              testName,
              { foo: 'bar' },
              { deduplication: { id: 'a1' } },
            );

            await deduplication;

            expect(deduplicatedCounter).toBe(1);
            await worker.close();
          });
        });
      });
    });
  });
});
