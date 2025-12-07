import { default as IORedis } from 'ioredis';
import { v4 } from 'uuid';
import { expect } from 'chai';
import { beforeEach, describe, it, before, after as afterAll } from 'mocha';
import { Job, Queue, QueueEvents, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('deduplication', function () {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  this.timeout(8000);
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  let connection: IORedis;
  before(async function () {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queue.waitUntilReady();
    await queueEvents.waitUntilReady();
  });

  afterEach(async function () {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('when job is debounced when added again with same debounce id', function () {
    describe('when ttl is provided', function () {
      it('used a fixed time period and emits debounced event', async function () {
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
            expect(jobId).to.be.equal(secondJob.id);
            expect(debounceId).to.be.equal('a1');
          } else {
            expect(jobId).to.be.equal(job.id);
            expect(debounceId).to.be.equal('a1');
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

        expect(debouncedCounter).to.be.equal(4);
      });

      describe('when removing debounced job', function () {
        it('removes debounce key', async function () {
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

          expect(debouncedCounter).to.be.equal(2);
        });

        describe('when manual removal on a debounced job in finished state', function () {
          it('does not remove debounced key', async function () {
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

            expect(deduplicatedCounter).to.be.equal(1);
            await worker.close();
          });
        });
      });
    });

    describe('when ttl is not provided', function () {
      it('waits until job is finished before removing debounce key', async function () {
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
            expect(jobId).to.be.equal('1');
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

        expect(count).to.be.eql(2);

        expect(debouncedCounter).to.be.equal(2);
        expect(secondJob.id).to.be.equal('4');
        await worker.close();
      });

      describe('when removing debounced job', function () {
        it('removes debounce key', async function () {
          const testName = 'test';

          const job = await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1' } },
          );

          let debouncedCounter = 0;
          queueEvents.on('debounced', ({ jobId }) => {
            debouncedCounter++;
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

          expect(debouncedCounter).to.be.equal(2);
        });
      });
    });
  });

  describe('when job is deduplicated when added again with same debounce id', function () {
    it('emits deduplicated event', async function () {
      const testName = 'test';
      const dedupId = 'dedupId';

      const waitingEvent = new Promise<void>((resolve, reject) => {
        queueEvents.on(
          'deduplicated',
          ({ jobId, deduplicationId, deduplicatedJobId }) => {
            try {
              expect(jobId).to.be.equal('a1');
              expect(deduplicationId).to.be.equal(dedupId);
              expect(deduplicatedJobId).to.be.equal('a2');
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

    describe('when removing deduplication key', function () {
      it('should stop deduplication', async function () {
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
              expect(job.deduplicationId).to.be.equal(deduplicationId);
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

      describe('when using removeDeduplicationKey from job instance', function () {
        describe('when job id is still present inside deduplication key', function () {
          it('should stop deduplication', async function () {
            const testName = 'test';
            const deduplicationId = 'dedupId';
            const worker = new Worker(
              queueName,
              async job => {
                const isDeduplicationKeyRemoved =
                  await job.removeDeduplicationKey();
                expect(isDeduplicationKeyRemoved).to.be.true;
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
                  expect(job.deduplicationId).to.be.equal(deduplicationId);
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
            expect(completedCounter).to.be.equal(2);

            await worker.close();
          });
        });

        describe('when job id is not present inside deduplication key', function () {
          it('should not stop deduplication', async function () {
            const testName = 'test';
            const deduplicationId = 'dedupId';
            const worker = new Worker(
              queueName,
              async job => {
                await delay(200);
                const isDeduplicationKeyRemoved =
                  await job.removeDeduplicationKey();
                expect(isDeduplicationKeyRemoved).to.be.false;
              },
              { autorun: false, connection, prefix },
            );
            await worker.waitUntilReady();

            let completedCounter = 0;
            const completing = new Promise<void>((resolve, reject) => {
              worker.on('completed', job => {
                try {
                  completedCounter++;
                  expect(job.deduplicationId).to.be.equal(deduplicationId);
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
            expect(completedCounter).to.be.equal(2);

            await worker.close();
          });
        });
      });
    });

    describe('when ttl is provided', function () {
      it('used a fixed time period and emits debounced event', async function () {
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
            expect(jobId).to.be.equal(secondJob.id);
            expect(deduplicationId).to.be.equal('a1');
          } else {
            expect(jobId).to.be.equal(job.id);
            expect(deduplicationId).to.be.equal('a1');
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

        expect(deduplicatedCounter).to.be.equal(4);
      });

      describe('when removing deduplicated job', function () {
        it('removes deduplication key', async function () {
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

          expect(deduplicatedCounter).to.be.equal(2);
        });
      });

      describe('when extend is provided as true', function () {
        it('resets ttl', async function () {
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
              expect(job.id).to.be.equal('1');
              expect(job.data.foo).to.be.equal('bar');
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

          expect(count).to.be.eql(1);

          expect(deduplicatedCounter).to.be.equal(2);
          await worker.close();
        });
      });

      describe('when replace is provided as true', function () {
        it('removes last job if it is in delayed state', async function () {
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
              expect(job.id).to.be.equal('2');
              expect(job.data.foo).to.be.equal('baz');
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
          expect(deduplicationJobId).to.be.equal(job2.id);

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
          expect(deduplicationJobId2).to.be.equal(job3.id);

          await completing;

          const count = await queue.getJobCountByTypes();

          expect(count).to.be.eql(2);

          expect(deduplicatedCounter).to.be.equal(1);
          await worker.close();
        });
      });

      describe('when extend is provided as true', function () {
        it('resets ttl', async function () {
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
              expect(job.id).to.be.equal('1');
              expect(job.data.foo).to.be.equal('bar');
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
          expect(deduplicationJobId).to.be.equal(job1.id);

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
          expect(deduplicationJobId2).to.be.equal(job3.id);

          await completing;

          const count = await queue.getJobCountByTypes();

          expect(count).to.be.eql(1);

          expect(deduplicatedCounter).to.be.equal(2);
          await worker.close();
        });
      });

      describe('when extend and replace options are provided as true', function () {
        it('resets ttl and removes last job if it is in delayed state', async function () {
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
              expect(job.id).to.be.equal('10');
              expect(job.data.foo).to.be.equal(9);
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
          expect(deduplicationJobId).to.be.equal(jobs[jobs.length - 1].id);

          await completing;

          const count = await queue.getJobCountByTypes();

          expect(count).to.be.eql(1);

          expect(deduplicatedCounter).to.be.equal(9);
          await worker.close();
        });
      });
    });

    describe('when ttl is not provided', function () {
      it('waits until job is finished before removing debounce key', async function () {
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
            expect(jobId).to.be.equal('1');
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

        expect(count).to.be.eql(2);

        expect(deduplicatedCounter).to.be.equal(2);
        expect(secondJob.id).to.be.equal('4');
        await worker.close();
      });

      describe('when replace is provided as true', function () {
        it('removes last job if it is in delayed state', async function () {
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
              expect(job.id).to.be.equal('2');
              expect(job.data.foo).to.be.equal('baz');
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
          expect(deduplicationJobId).to.be.equal(job2.id);

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
          expect(deduplicationJobId2).to.be.equal(job3.id);

          await completing;

          const count = await queue.getJobCountByTypes();

          expect(count).to.be.eql(1);

          expect(deduplicatedCounter).to.be.equal(1);
          await worker.close();
        });
      });

      describe('when removing deduplicated job', function () {
        it('removes deduplication key', async function () {
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

          expect(deduplicatedCounter).to.be.equal(2);
        });

        describe('when manual removal on a deduplicated job in finished state', function () {
          it('does not remove deduplication key', async function () {
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

            expect(deduplicatedCounter).to.be.equal(1);
            await worker.close();
          });
        });
      });
    });
  });
});
