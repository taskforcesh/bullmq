import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { after, every } from 'lodash';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { FlowProducer, Queue, QueueEvents, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Rate Limiter', function () {
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

  it('should not put a job into the delayed queue when limit is hit', async function () {
    this.timeout(6000);
    const numJobs = 5;
    const worker = new Worker(
      queueName,
      async () => {
        await delay(200);
      },
      {
        connection,
        concurrency: 5,
        limiter: {
          max: 1,
          duration: 1000,
        },
      },
    );
    await worker.waitUntilReady();

    queueEvents.on('failed', () => {});

    const jobs = Array.from(Array(numJobs).keys()).map(() => ({
      name: 'test',
      data: {},
    }));
    await queue.addBulk(jobs);

    await delay(100);

    const delayedCount = await queue.getDelayedCount();
    expect(delayedCount).to.equal(0);
    await worker.close();
  });

  it('should obey the rate limit', async function () {
    this.timeout(20000);

    const numJobs = 10;

    const worker = new Worker(queueName, async () => {}, {
      connection,
      limiter: {
        max: 1,
        duration: 1000,
      },
    });

    const result = new Promise<void>((resolve, reject) => {
      queueEvents.on(
        'completed',
        // after every job has been completed
        after(numJobs, async () => {
          await worker.close();

          try {
            const timeDiff = new Date().getTime() - startTime;
            expect(timeDiff).to.be.gte((numJobs - 1) * 1000);
            resolve();
          } catch (err) {
            reject(err);
          }
        }),
      );

      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });
    });

    const startTime = new Date().getTime();
    const jobs = Array.from(Array(numJobs).keys()).map(() => ({
      name: 'rate test',
      data: {},
    }));
    await queue.addBulk(jobs);

    await result;
    await worker.close();
  });

  describe('when queue is paused between rate limit', () => {
    it('should add active jobs to paused', async function () {
      this.timeout(20000);

      const numJobs = 4;

      const commontOpts = {
        connection,
        limiter: {
          max: 1,
          duration: 2000,
        },
      };
      const worker1 = new Worker(queueName, async () => {}, commontOpts);
      const worker2 = new Worker(queueName, async () => {}, commontOpts);
      const worker3 = new Worker(queueName, async () => {}, commontOpts);
      const worker4 = new Worker(queueName, async () => {}, commontOpts);

      const result = new Promise<void>((resolve, reject) => {
        queueEvents.once('completed', async () => {
          resolve();
        });

        queueEvents.on('failed', async err => {
          reject(err);
        });
      });

      await delay(500);

      const jobs = Array.from(Array(numJobs).keys()).map(() => ({
        name: 'rate test',
        data: {},
      }));
      await queue.addBulk(jobs);

      await queue.pause();

      await result;

      await delay(500);

      const counts = await queue.getJobCounts('paused', 'completed', 'wait');
      expect(counts).to.have.property('paused', numJobs - 1);
      expect(counts).to.have.property('completed', 1);
      expect(counts).to.have.property('wait', 0);

      await worker1.close();
      await worker2.close();
      await worker3.close();
      await worker4.close();
    });
  });

  describe('when using flows', () => {
    it('should obey the rate limit per queue', async function () {
      this.timeout(20000);
      const name = 'child-job';
      const parentQueueName = `parent-queue-${v4()}`;
      const parentQueueEvents = new QueueEvents(parentQueueName, {
        connection,
      });
      const numJobs = 10;

      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
        },
        {
          connection,
          concurrency: 2,
          limiter: {
            max: 1,
            duration: 1000,
          },
        },
      );

      const parentWorker = new Worker(
        parentQueueName,
        async () => {
          await delay(100);
        },
        {
          connection,
          concurrency: 2,
          limiter: {
            max: 1,
            duration: 2000,
          },
        },
      );

      const flow = new FlowProducer({ connection });
      const result = new Promise<void>((resolve, reject) => {
        queueEvents.on(
          'completed',
          // after every job has been completed
          after(numJobs, async () => {
            await worker.close();

            try {
              const timeDiff = new Date().getTime() - startTime;
              expect(timeDiff).to.be.gte((numJobs - 1) * 1000);
              resolve();
            } catch (err) {
              reject(err);
            }
          }),
        );

        queueEvents.on('failed', async err => {
          await worker.close();
          reject(err);
        });
      });

      const parentResult = new Promise<void>((resolve, reject) => {
        parentQueueEvents.on(
          'completed',
          // after every job has been completed
          after(numJobs / 2, async () => {
            await worker.close();

            try {
              const timeDiff = new Date().getTime() - startTime;
              expect(timeDiff).to.be.gte((numJobs / 2 - 1) * 2000);
              resolve();
            } catch (err) {
              reject(err);
            }
          }),
        );

        parentQueueEvents.on('failed', async err => {
          await worker.close();
          reject(err);
        });
      });

      const startTime = new Date().getTime();
      const values = Array.from(Array(5).keys()).map(() => ({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          { name, data: { idx: 0, foo: 'bar' }, queueName },
          { name, data: { idx: 1, foo: 'baz' }, queueName },
        ],
      }));
      await flow.addBulk(values);

      await result;
      await parentResult;
      await worker.close();
      await parentWorker.close();
      await parentQueueEvents.close();
    });
  });

  it('should obey the rate limit with max value greater than 1', async function () {
    this.timeout(20000);

    const numJobs = 10;

    const worker = new Worker(queueName, async () => {}, {
      connection,
      limiter: {
        max: 2,
        duration: 1000,
      },
    });

    const result = new Promise<void>((resolve, reject) => {
      queueEvents.on(
        'completed',
        // after every job has been completed
        after(numJobs, async () => {
          await worker.close();

          try {
            const timeDiff = new Date().getTime() - startTime;
            expect(timeDiff).to.be.gte(numJobs / 2 - 1 * 1000);
            resolve();
          } catch (err) {
            reject(err);
          }
        }),
      );

      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });
    });

    const startTime = new Date().getTime();
    const jobs = Array.from(Array(numJobs).keys()).map(() => ({
      name: 'rate test',
      data: {},
    }));
    await queue.addBulk(jobs);

    await result;
    await worker.close();
  });

  describe('when dynamic limit is used', () => {
    it('should obey the rate limit', async function () {
      this.timeout(5000);

      const numJobs = 10;
      const dynamicLimit = 250;
      const duration = 100;
      const margin = 0.95; // 5% margin for CI

      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsMade === 1) {
            await worker.rateLimit(dynamicLimit);
            throw Worker.RateLimitError();
          }
        },
        {
          connection,
          limiter: {
            max: 1,
            duration,
          },
        },
      );

      const result = new Promise<void>((resolve, reject) => {
        queueEvents.on(
          'completed',
          // after every job has been completed
          after(numJobs, async () => {
            await worker.close();

            try {
              const timeDiff = new Date().getTime() - startTime;
              expect(timeDiff).to.be.gte(
                (numJobs * dynamicLimit + numJobs * duration) * margin,
              );
              resolve();
            } catch (err) {
              reject(err);
            }
          }),
        );

        queueEvents.on('failed', async err => {
          await worker.close();
          reject(err);
        });
      });

      const startTime = new Date().getTime();
      const jobs = Array.from(Array(numJobs).keys()).map(() => ({
        name: 'rate test',
        data: {},
      }));
      await queue.addBulk(jobs);

      await result;
      await worker.close();
    });

    describe('when priority is provided', () => {
      it('should obey the rate limit respecting priority', async function () {
        this.timeout(6000);

        let extraCount = 3;
        let priority = 9;
        const numJobs = 4;
        const dynamicLimit = 250;
        const duration = 100;

        const worker = new Worker(
          queueName,
          async job => {
            if (job.attemptsMade === 1) {
              if (extraCount > 0) {
                await queue.add('rate test', {}, { priority });
                priority -= 1;
                extraCount -= 1;
              }
              await worker.rateLimit(dynamicLimit);
              throw Worker.RateLimitError();
            }
          },
          {
            connection,
            limiter: {
              max: 1,
              duration,
            },
          },
        );

        const result = new Promise<void>((resolve, reject) => {
          queueEvents.on(
            'completed',
            // after every job has been completed
            after(numJobs, async args => {
              await worker.close();

              try {
                expect(args.jobId).to.be.equal('1');
                resolve();
              } catch (err) {
                reject(err);
              }
            }),
          );

          queueEvents.on('failed', async err => {
            await worker.close();
            reject(err);
          });
        });

        await queue.add('rate test', {}, { priority: 10 });

        await result;
        await worker.close();
      });

      describe('when priority is the same for some jobs', () => {
        it('should get jobs in fifo order', async function () {
          this.timeout(6000);

          const numJobs = 4;
          const dynamicLimit = 500;
          const duration = 100;

          const worker = new Worker(
            queueName,
            async () => {
              await worker.rateLimit(dynamicLimit);
              throw Worker.RateLimitError();
            },
            {
              connection,
              limiter: {
                max: 1,
                duration,
              },
            },
          );
          await worker.waitUntilReady();

          for (let i = 1; i <= numJobs; i++) {
            await queue.add(`${i}`, {}, { priority: 10 });
          }

          await delay(dynamicLimit / 2);

          const jobs = await queue.getJobs(['prioritized'], 0, -1, true);
          expect(jobs.map(x => x.name)).to.eql(['1', '2', '3', '4']);

          await worker.close();
        });
      });

      describe('when priority is different for some jobs', () => {
        it('should get jobs in fifo order', async function () {
          this.timeout(6000);

          const numJobs = 4;
          const dynamicLimit = 250;
          const duration = 100;

          const worker = new Worker(
            queueName,
            async () => {
              await worker.rateLimit(dynamicLimit);
              throw Worker.RateLimitError();
            },
            {
              connection,
              limiter: {
                max: 1,
                duration,
              },
            },
          );

          for (let i = 1; i <= numJobs; i++) {
            await queue.add(`${i}`, {}, { priority: ((i - 1) % 2) + 1 });
          }

          await delay(dynamicLimit * 4);

          const jobs = await queue.getJobs(['prioritized'], 0, -1, true);
          expect(jobs.map(x => x.name)).to.eql(['1', '3', '2', '4']);

          await worker.close();
        });
      });
    });

    describe('when queue is paused', () => {
      it('moves job to paused', async function () {
        const dynamicLimit = 250;
        const duration = 100;

        const worker = new Worker(
          queueName,
          async job => {
            if (job.attemptsMade === 1) {
              await queue.pause();
              await delay(150);
              await worker.rateLimit(dynamicLimit);
              throw Worker.RateLimitError();
            }
          },
          {
            connection,
            autorun: false,
            limiter: {
              max: 1,
              duration,
            },
          },
        );

        const result = new Promise<void>((resolve, reject) => {
          queueEvents.on(
            'waiting',
            // after every job has been moved to waiting again
            after(2, () => {
              resolve();
            }),
          );
        });

        await delay(200);
        await queue.add('rate test', {});

        worker.run();

        await result;

        const pausedCount = await queue.getJobCountByTypes('paused');
        expect(pausedCount).to.equal(1);

        await worker.close();
      });
    });
  });

  describe('when there are more added jobs than max limiter', () => {
    it('processes jobs as max limiter from the beginning', async function () {
      this.timeout(5000);
      let parallelJobs = 0;

      const processor = async () => {
        parallelJobs++;
        await delay(700);

        parallelJobs--;

        expect(parallelJobs).to.be.lessThanOrEqual(100);

        return 'success';
      };

      const worker = new Worker(queueName, processor, {
        concurrency: 600,
        autorun: false,
        limiter: {
          max: 100,
          duration: 1000,
        },
        connection,
      });

      const allCompleted = new Promise(resolve => {
        worker.on('completed', after(400, resolve));
      });

      const jobs = Array(400)
        .fill('')
        .map((_, index) => {
          return {
            name: 'test-job',
            data: { id: `id-${index}` },
          };
        });

      await queue.addBulk(jobs);

      worker.run();
      await allCompleted;

      await worker.close();
    });

    describe('when rate limit is max 1', () => {
      it('processes jobs as max limiter from the beginning', async function () {
        this.timeout(5000);
        let parallelJobs = 0;

        const processor = async () => {
          parallelJobs++;
          await delay(700);

          parallelJobs--;

          expect(parallelJobs).to.be.lessThanOrEqual(1);

          return 'success';
        };

        const worker = new Worker(queueName, processor, {
          concurrency: 100,
          autorun: false,
          limiter: {
            max: 1,
            duration: 1000,
          },
          connection,
        });

        const allCompleted = new Promise(resolve => {
          worker.on('completed', after(5, resolve));
        });

        const jobs = Array(5)
          .fill('')
          .map((_, index) => {
            return {
              name: 'test-job',
              data: { id: `id-${index}` },
            };
          });

        await queue.addBulk(jobs);

        worker.run();
        await allCompleted;

        await worker.close();
      });
    });
  });

  it('should obey priority', async function () {
    this.timeout(10000);

    const numJobs = 10;
    const priorityBuckets: { [key: string]: number } = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
    };

    await queue.pause();

    for (let i = 0; i < numJobs; i++) {
      const priority = (i % 4) + 1;
      const opts = { priority };

      priorityBuckets[priority] = priorityBuckets[priority] + 1;

      await queue.add('priority test', { id: i }, opts);
    }

    const priorityBucketsBefore = { ...priorityBuckets };

    const worker = new Worker(
      queueName,
      async job => {
        const { priority } = job.opts;

        priorityBuckets[priority] = priorityBuckets[priority] - 1;

        for (let p = 1; p < priority; p++) {
          if (priorityBuckets[p] > 0) {
            const before = JSON.stringify(priorityBucketsBefore);
            const after = JSON.stringify(priorityBuckets);
            throw new Error(
              `Priority was not enforced, job with priority ${priority} was processed before all jobs with priority ${p}
              were processed. Bucket counts before: ${before} / after: ${after}`,
            );
          }
        }

        return Promise.resolve();
      },
      {
        connection,
        limiter: {
          max: 1,
          duration: 10,
        },
      },
    );
    await worker.waitUntilReady();

    await queue.resume();

    const result = new Promise<void>((resolve, reject) => {
      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });

      queueEvents.on(
        'completed',
        after(numJobs, () => {
          try {
            expect(every(priorityBuckets, value => value === 0)).to.eq(true);
            resolve();
          } catch (err) {
            reject(err);
          }
        }),
      );
    });

    await result;
    await worker.close();
  });
});
