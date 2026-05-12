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

import { Job, Queue, QueueEvents, Worker } from '../src/classes';
import { delay, randomUUID, removeAllQueueData } from '../src/utils';

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
    queueName = `test-${randomUUID()}`;
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

      let deduplicatedResult:
        | {
            jobId: string;
            deduplicationId: string;
            deduplicatedJobId: string;
            job: any;
            deduplicatedJob: any;
          }
        | undefined;
      const waitingEvent = Promise.race([
        new Promise<void>((resolve, reject) => {
          queueEvents.once(
            'deduplicated',
            async ({ jobId, deduplicationId, deduplicatedJobId }) => {
              try {
                const job = await queue.getJob(jobId);
                const deduplicatedJob = await queue.getJob(deduplicatedJobId);
                deduplicatedResult = {
                  jobId,
                  deduplicationId,
                  deduplicatedJobId,
                  job,
                  deduplicatedJob,
                };
                resolve();
              } catch (error) {
                reject(error);
              }
            },
          );
        }),
        delay(100),
      ]);

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
      expect(deduplicatedResult?.job).toBeDefined();
      expect(deduplicatedResult?.jobId).toBe('a1');
      expect(deduplicatedResult?.deduplicationId).toBe(dedupId);
      expect(deduplicatedResult?.deduplicatedJob).toBeUndefined();
      expect(deduplicatedResult?.deduplicatedJobId).toBe('a2');
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

  describe('when keepLastIfActive is true', () => {
    it('should store next job data and create new job when active job completes', async () => {
      const testName = 'test';
      const deduplicationId = 'dedup-active-1';
      const processedData: any[] = [];

      let resolveFirstProcessing: () => void;
      const firstProcessingStarted = new Promise<void>(resolve => {
        resolveFirstProcessing = resolve;
      });

      const worker = new Worker(
        queueName,
        async job => {
          if (processedData.length === 0) {
            resolveFirstProcessing();
            // Hold the first job active for a while
            await delay(500);
          }
          processedData.push(job.data);
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      const allCompleted = new Promise<void>(resolve => {
        let count = 0;
        worker.on('completed', () => {
          count++;
          if (count === 2) {
            resolve();
          }
        });
      });

      worker.run();

      // Add first job
      const job1 = await queue.add(
        testName,
        { seq: 1 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      // Wait for first job to start processing
      await firstProcessingStarted;

      // Add second job while first is active — should be deduplicated
      // but next job data is stored for when the active job completes
      const job2 = await queue.add(
        testName,
        { seq: 2 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      // Returns the existing active job's ID (deduplicated)
      expect(job2.id).toBe(job1.id);

      await allCompleted;

      // Both jobs processed: first has original data, second has latest data
      expect(processedData).toHaveLength(2);
      expect(processedData[0]).toEqual({ seq: 1 });
      expect(processedData[1]).toEqual({ seq: 2 });

      await worker.close();
    });

    it('should still deduplicate when dedup job is waiting (not active)', async () => {
      const testName = 'test';
      const deduplicationId = 'dedup-waiting-1';

      let deduplicatedCount = 0;
      queueEvents.on('deduplicated', () => {
        deduplicatedCount++;
      });

      // Add first job (goes to waiting, not active since no worker)
      const job1 = await queue.add(
        testName,
        { seq: 1 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      // Add second job - should be deduplicated since first is waiting
      const job2 = await queue.add(
        testName,
        { seq: 2 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      await delay(100);

      // job2 should have the same ID as job1 (was deduplicated)
      expect(job2.id).toBe(job1.id);
      expect(deduplicatedCount).toBe(1);
    });

    it('should replace stored data with latest when multiple jobs added while active', async () => {
      const testName = 'test';
      const deduplicationId = 'dedup-latest-1';
      const processedData: any[] = [];

      let resolveFirstProcessing: () => void;
      const firstProcessingStarted = new Promise<void>(resolve => {
        resolveFirstProcessing = resolve;
      });

      const worker = new Worker(
        queueName,
        async job => {
          if (processedData.length === 0) {
            resolveFirstProcessing();
            await delay(500);
          }
          processedData.push(job.data);
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      const allCompleted = new Promise<void>(resolve => {
        let count = 0;
        worker.on('completed', () => {
          count++;
          if (count === 2) {
            resolve();
          }
        });
      });

      worker.run();

      // Add first job
      await queue.add(
        testName,
        { seq: 1 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      await firstProcessingStarted;

      // Add second job while first is active
      await queue.add(
        testName,
        { seq: 2 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      // Add third job while first is still active — replaces stored data
      await queue.add(
        testName,
        { seq: 3 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      await allCompleted;

      // Only 2 jobs processed: first with seq:1, second with latest data seq:3
      expect(processedData).toHaveLength(2);
      expect(processedData[0]).toEqual({ seq: 1 });
      expect(processedData[1]).toEqual({ seq: 3 });

      await worker.close();
    });

    it('should not allow parallel execution of jobs with same dedup id', async () => {
      const testName = 'test';
      const deduplicationId = 'dedup-no-parallel-1';
      let activeCount = 0;
      let maxActiveCount = 0;

      let resolveFirstProcessing: () => void;
      const firstProcessingStarted = new Promise<void>(resolve => {
        resolveFirstProcessing = resolve;
      });

      const worker = new Worker(
        queueName,
        async () => {
          activeCount++;
          maxActiveCount = Math.max(maxActiveCount, activeCount);
          if (activeCount === 1 && maxActiveCount === 1) {
            resolveFirstProcessing();
          }
          await delay(200);
          activeCount--;
        },
        { autorun: false, connection, prefix, concurrency: 5 },
      );
      await worker.waitUntilReady();

      const allCompleted = new Promise<void>(resolve => {
        let count = 0;
        worker.on('completed', () => {
          count++;
          if (count === 2) {
            resolve();
          }
        });
      });

      worker.run();

      // Add first job
      await queue.add(
        testName,
        { seq: 1 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      await firstProcessingStarted;

      // Add second job while first is active
      await queue.add(
        testName,
        { seq: 2 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      await allCompleted;

      // Never more than 1 job active at a time for this dedup id
      expect(maxActiveCount).toBe(1);

      await worker.close();
    });

    it('should properly clean up after both jobs complete', async () => {
      const testName = 'test';
      const deduplicationId = 'dedup-cleanup-1';

      let resolveFirstProcessing: () => void;
      const firstProcessingStarted = new Promise<void>(resolve => {
        resolveFirstProcessing = resolve;
      });

      let processCount = 0;
      const worker = new Worker(
        queueName,
        async () => {
          processCount++;
          if (processCount === 1) {
            resolveFirstProcessing();
            await delay(300);
          }
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      const allCompleted = new Promise<void>(resolve => {
        let completed = 0;
        worker.on('completed', () => {
          completed++;
          if (completed === 2) {
            resolve();
          }
        });
      });

      worker.run();

      // First job
      await queue.add(
        testName,
        { seq: 1 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      await firstProcessingStarted;

      // Second job while first is active
      await queue.add(
        testName,
        { seq: 2 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      await allCompleted;

      // Register listener before adding job3 to avoid race condition
      const thirdCompleted = new Promise<void>(resolve => {
        worker.on('completed', job => {
          if (job.data.seq === 3) {
            resolve();
          }
        });
      });

      // After both jobs complete, a new add should work normally
      const job3 = await queue.add(
        testName,
        { seq: 3 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      await thirdCompleted;
      expect(processCount).toBe(3);

      await worker.close();
    });

    it('should work with ttl option', async () => {
      const testName = 'test';
      const deduplicationId = 'dedup-ttl-active-1';
      const processedData: any[] = [];

      let resolveFirstProcessing: () => void;
      const firstProcessingStarted = new Promise<void>(resolve => {
        resolveFirstProcessing = resolve;
      });

      const worker = new Worker(
        queueName,
        async job => {
          if (processedData.length === 0) {
            resolveFirstProcessing();
            await delay(300);
          }
          processedData.push(job.data);
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      const allCompleted = new Promise<void>(resolve => {
        let completed = 0;
        worker.on('completed', () => {
          completed++;
          if (completed === 2) {
            resolve();
          }
        });
      });

      worker.run();

      // First job with ttl
      await queue.add(
        testName,
        { seq: 1 },
        {
          deduplication: {
            id: deduplicationId,
            ttl: 10000,
            keepLastIfActive: true,
          },
        },
      );

      await firstProcessingStarted;

      // Second job while first is active — next job data stored
      await queue.add(
        testName,
        { seq: 2 },
        {
          deduplication: {
            id: deduplicationId,
            ttl: 10000,
            keepLastIfActive: true,
          },
        },
      );

      await allCompleted;

      expect(processedData).toHaveLength(2);
      expect(processedData[0]).toEqual({ seq: 1 });
      expect(processedData[1]).toEqual({ seq: 2 });

      await worker.close();
    });

    it('should add next job to paused list when queue is paused and process after resume', async () => {
      const testName = 'test';
      const deduplicationId = 'dedupPause';
      const processedData: any[] = [];

      let firstJobResolve: () => void;
      const firstProcessingStarted = new Promise<void>(
        resolve => (firstJobResolve = resolve),
      );

      let allowFirstToComplete: () => void;
      const firstJobGate = new Promise<void>(
        resolve => (allowFirstToComplete = resolve),
      );

      const worker = new Worker(
        queueName,
        async job => {
          if (processedData.length === 0) {
            firstJobResolve();
            await firstJobGate;
          }
          processedData.push(job.data);
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      const allCompleted = new Promise<void>(resolve => {
        let completed = 0;
        worker.on('completed', () => {
          completed++;
          if (completed === 2) {
            resolve();
          }
        });
      });

      worker.run();

      // Add first job
      await queue.add(
        testName,
        { seq: 1 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      await firstProcessingStarted;

      // Pause the queue while first job is active
      await queue.pause();

      // Add second job while paused and first is active
      await queue.add(
        testName,
        { seq: 2 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      // Let first job complete — moveToFinished should put next job in paused list
      allowFirstToComplete();

      // Wait a bit for the first job to finish
      await delay(500);

      // Verify the next job is in paused state (not processed yet)
      expect(processedData).toHaveLength(1);
      expect(processedData[0]).toEqual({ seq: 1 });

      // Resume the queue — paused jobs move to wait
      await queue.resume();

      await allCompleted;

      expect(processedData).toHaveLength(2);
      expect(processedData[0]).toEqual({ seq: 1 });
      expect(processedData[1]).toEqual({ seq: 2 });

      await worker.close();
    });

    it('should allow delay with keepLastIfActive', async () => {
      const deduplicationId = 'dedupDelay';

      const job = await queue.add(
        'test',
        { seq: 1 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
          delay: 5000,
        },
      );

      expect(job.id).toBeDefined();

      const state = await job.getState();
      expect(state).toBe('delayed');
    });

    it('should allow queue default delay with keepLastIfActive', async () => {
      const queueWithDelay = new Queue(queueName, {
        connection,
        prefix,
        defaultJobOptions: { delay: 5000 },
      });

      const deduplicationId = 'dedupDefaultDelay';

      try {
        const job = await queueWithDelay.add(
          'test',
          { seq: 1 },
          {
            deduplication: {
              id: deduplicationId,
              keepLastIfActive: true,
            },
          },
        );

        expect(job.id).toBeDefined();

        const state = await job.getState();
        expect(state).toBe('delayed');
      } finally {
        await queueWithDelay.close();
      }
    });

    it('should requeue with delay when active job completes and next job was stored', async () => {
      const deduplicationId = 'dedupDelayRequeue';
      const processedData: any[] = [];
      const delay = 1000;

      let resolveFirstProcessing: () => void;
      const firstProcessingStarted = new Promise<void>(resolve => {
        resolveFirstProcessing = resolve;
      });

      let resolveSecondCompleted: () => void;
      const secondCompleted = new Promise<void>(resolve => {
        resolveSecondCompleted = resolve;
      });

      const worker = new Worker(
        queueName,
        async job => {
          processedData.push(job.data);
          if (processedData.length === 1) {
            resolveFirstProcessing!();
            // Hold active long enough for a second add to arrive
            await new Promise(r => setTimeout(r, 500));
          }
        },
        { connection, prefix, autorun: false },
      );

      worker.on('completed', () => {
        if (processedData.length === 2) {
          resolveSecondCompleted!();
        }
      });

      // First job – added with delay
      await queue.add(
        'test',
        { seq: 1 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
          delay,
        },
      );

      worker.run();

      // Wait until first job is active
      await firstProcessingStarted;

      // Add a second job while first is active — should be stored
      await queue.add(
        'test',
        { seq: 2 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
          delay,
        },
      );

      await secondCompleted;

      expect(processedData).toHaveLength(2);
      expect(processedData[0]).toEqual({ seq: 1 });
      expect(processedData[1]).toEqual({ seq: 2 });

      await worker.close();
    });

    it('should requeue next job when active job fails permanently', async () => {
      const testName = 'test';
      const deduplicationId = 'dedup-fail-1';
      const processedData: any[] = [];

      let resolveFirstProcessing: () => void;
      const firstProcessingStarted = new Promise<void>(resolve => {
        resolveFirstProcessing = resolve;
      });

      const worker = new Worker(
        queueName,
        async job => {
          processedData.push(job.data);
          if (processedData.length === 1) {
            resolveFirstProcessing();
            // Hold the first job active for a while then fail it
            await delay(500);
            throw new Error('intentional failure');
          }
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      const firstFailed = new Promise<void>(resolve => {
        worker.on('failed', () => {
          resolve();
        });
      });

      const secondCompleted = new Promise<void>(resolve => {
        worker.on('completed', () => {
          resolve();
        });
      });

      worker.run();

      // Add first job
      const job1 = await queue.add(
        testName,
        { seq: 1 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
          attempts: 1,
        },
      );

      await firstProcessingStarted;

      // Add second job while first is active
      const job2 = await queue.add(
        testName,
        { seq: 2 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      expect(job2.id).toBe(job1.id);

      await firstFailed;
      await secondCompleted;

      // Both jobs processed: first failed, second completed with latest data
      expect(processedData).toHaveLength(2);
      expect(processedData[0]).toEqual({ seq: 1 });
      expect(processedData[1]).toEqual({ seq: 2 });

      await worker.close();
    });

    it('should requeue next job only after retries are exhausted', async () => {
      const testName = 'test';
      const deduplicationId = 'dedup-retry-1';
      const processedData: any[] = [];
      let attemptCount = 0;

      let resolveFirstProcessing: () => void;
      const firstProcessingStarted = new Promise<void>(resolve => {
        resolveFirstProcessing = resolve;
      });

      const worker = new Worker(
        queueName,
        async job => {
          if (job.data.seq === 1) {
            attemptCount++;
            if (attemptCount === 1) {
              resolveFirstProcessing();
              await delay(300);
            }
            // Fail on all attempts for the first job
            throw new Error('retry failure');
          }
          processedData.push(job.data);
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      const allDone = new Promise<void>(resolve => {
        let completedCount = 0;
        worker.on('completed', () => {
          completedCount++;
          if (completedCount === 1) {
            resolve();
          }
        });
      });

      // Wait for the retries-exhausted event to confirm all retries happened
      const retriesExhausted = new Promise<void>(resolve => {
        queueEvents.on('retries-exhausted', () => {
          resolve();
        });
      });

      worker.run();

      // Add first job with 3 attempts
      await queue.add(
        testName,
        { seq: 1 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
          attempts: 3,
          backoff: { type: 'fixed', delay: 50 },
        },
      );

      await firstProcessingStarted;

      // Add second job while first is active
      await queue.add(
        testName,
        { seq: 2 },
        {
          deduplication: {
            id: deduplicationId,
            keepLastIfActive: true,
          },
        },
      );

      await retriesExhausted;
      await allDone;

      // First job retried 3 times (all failed), then next job was created and completed
      expect(attemptCount).toBe(3);
      expect(processedData).toHaveLength(1);
      expect(processedData[0]).toEqual({ seq: 2 });

      await worker.close();
    });

    it('should prevent parallel execution even when ttl expires while job is active', async () => {
      const testName = 'test';
      const deduplicationId = 'dedup-ttl-expire-1';
      const processedData: any[] = [];

      let resolveFirstProcessing: () => void;
      const firstProcessingStarted = new Promise<void>(resolve => {
        resolveFirstProcessing = resolve;
      });

      const worker = new Worker(
        queueName,
        async job => {
          if (processedData.length === 0) {
            resolveFirstProcessing();
            // Hold first job active longer than the TTL (200ms)
            await delay(500);
          }
          processedData.push(job.data);
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      const allCompleted = new Promise<void>(resolve => {
        let count = 0;
        worker.on('completed', () => {
          count++;
          if (count === 2) {
            resolve();
          }
        });
      });

      worker.run();

      // Add first job with a short TTL
      const job1 = await queue.add(
        testName,
        { seq: 1 },
        {
          deduplication: {
            id: deduplicationId,
            ttl: 200,
            keepLastIfActive: true,
          },
        },
      );

      await firstProcessingStarted;

      // Wait for TTL to expire while job is still active
      await delay(300);

      // Add second job after TTL expired — should still be deduplicated
      // because keepLastIfActive prevents the dedup key from expiring
      const job2 = await queue.add(
        testName,
        { seq: 2 },
        {
          deduplication: {
            id: deduplicationId,
            ttl: 200,
            keepLastIfActive: true,
          },
        },
      );

      // Should still be deduplicated (returns first job's ID)
      expect(job2.id).toBe(job1.id);

      await allCompleted;

      expect(processedData).toHaveLength(2);
      expect(processedData[0]).toEqual({ seq: 1 });
      expect(processedData[1]).toEqual({ seq: 2 });

      await worker.close();
    });
  });
});
