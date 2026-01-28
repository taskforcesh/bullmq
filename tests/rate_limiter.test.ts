import { default as IORedis } from 'ioredis';
import { after, every } from 'lodash';
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
import {
  FlowProducer,
  Queue,
  QueueEvents,
  RateLimitError,
  Worker,
  UnrecoverableError,
  Job,
} from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Rate Limiter', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let queue: Queue;
  let queueName: string;
  let queueEvents: QueueEvents;

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

  it('should not put a job into the delayed queue when limit is hit', async () => {
    // TODO: Move timeout to test options: { timeout: 6000 }
    const numJobs = 5;
    const worker = new Worker(
      queueName,
      async () => {
        await delay(200);
      },
      {
        connection,
        prefix,
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
    expect(delayedCount).toBe(0);
    await worker.close();
  });

  describe('when setting rate limit globally', () => {
    it('should obey the rate limit', async () => {
      // TODO: Move timeout to test options: { timeout: 7000 }

      const numJobs = 10;

      const worker = new Worker(
        queueName,
        async () => {
          const currentTtl = await queue.getRateLimitTtl();
          expect(currentTtl).to.be.lessThanOrEqual(500);
          expect(currentTtl).toBeGreaterThan(200);
        },
        {
          connection,
          prefix,
        },
      );

      await queue.setGlobalRateLimit(1, 500);
      const globalRateLimit = await queue.getGlobalRateLimit();

      expect(globalRateLimit).toEqual({ max: 1, duration: 500 });

      const result = new Promise<void>((resolve, reject) => {
        queueEvents.on(
          'completed',
          // after every job has been completed
          after(numJobs, async () => {
            try {
              const timeDiff = new Date().getTime() - startTime;
              expect(timeDiff).to.be.gte((numJobs - 1) * 500);
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

    describe('when rate limit is removed', () => {
      it('should execute jobs without rate limit', async () => {
        // TODO: Move timeout to test options: { timeout: 2000 }

        const numJobs = 10;

        const worker = new Worker(
          queueName,
          async () => {
            const currentTtl = await queue.getRateLimitTtl();
            expect(currentTtl).toBe(-2); // -2 means no rate limit
          },
          {
            connection,
            prefix,
          },
        );

        await queue.setGlobalRateLimit(1, 500);
        await queue.removeGlobalRateLimit();

        const globalRateLimit = await queue.getGlobalRateLimit();

        expect(globalRateLimit).toBeNull();

        const result = new Promise<void>((resolve, reject) => {
          queueEvents.on(
            'completed',
            // after every job has been completed
            after(numJobs, async () => {
              try {
                const timeDiff = new Date().getTime() - startTime;
                expect(timeDiff).to.be.lte(150);
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

        const jobs = Array.from(Array(numJobs).keys()).map(() => ({
          name: 'rate test',
          data: {},
        }));
        const startTime = new Date().getTime();
        await queue.addBulk(jobs);

        await result;
        await worker.close();
      });
    });
  });

  it('should obey the rate limit', { timeout: 15000 }, async () => {
    const numJobs = 10;

    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
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

  it('should respect processing time without adding limiter delay', async () => {
    // TODO: Move timeout to test options: { timeout: 12000 }

    const numJobs = 40;

    const worker = new Worker(
      queueName,
      async () => {
        await delay(Math.floor(1 + Math.random() * 4));
      },
      {
        connection,
        prefix,
        concurrency: 5,
        limiter: {
          max: 4,
          duration: 1000,
        },
      },
    );

    let completedCount = 0;
    const result = new Promise<void>((resolve, reject) => {
      worker.on('completed', async job => {
        try {
          completedCount++;
          expect(job.finishedOn! - job.processedOn!).to.be.lte(1000);
          if (completedCount === numJobs) {
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      });

      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });
    });

    const jobs = Array.from(Array(numJobs).keys()).map(() => ({
      name: 'rate test',
      data: {},
    }));
    await queue.addBulk(jobs);

    await result;
    await worker.close();
  });

  it('should quickly close a worker even with slow rate-limit', async () => {
    const limiter = { max: 1, duration: 60 * 1000 };
    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
      limiter,
    });

    await queue.add('test', 1);
    await delay(500);
    await worker.close();
  });

  describe('when a job never completed', () => {
    it('should not block the rate limit', async () => {
      // TODO: Move timeout to test options: { timeout: 20000 }
      const numJobs = 20;
      const queue = new Queue(queueName, {
        prefix,
        connection,
      });

      const worker = new Worker(
        queueName,
        async (job: Job) => {
          if (job.data == 'delay') {
            // This simulates a job that will never resolve.
            await new Promise(resolve => {});
            return;
          }

          if (job.data == 'test') {
            return 'Success';
          }
        },
        {
          autorun: false,
          connection,
          prefix,
          concurrency: 2,
          limiter: {
            max: 5,
            duration: 1000,
          },
        },
      );

      const completing = new Promise<void>((resolve, reject) => {
        worker.on(
          'completed',
          // after every job has been completed except the one that never resolves
          after(numJobs - 1, async () => {
            // We need to forcefully close the worker
            await worker.close(true);
            resolve();
          }),
        );
      });

      await queue.add('delay-job', 'delay');

      for (let i = 0; i < numJobs; i++) {
        await queue.add('test-job', 'test');
      }

      worker.run();

      await completing;

      await worker.close(true);
    });
  });

  describe('when queue is paused between rate limit', () => {
    it('should add active jobs to paused', async () => {
      // TODO: Move timeout to test options: { timeout: 20000 }

      const numJobs = 4;

      const commontOpts = {
        connection,
        prefix,
        limiter: {
          max: 1,
          duration: 2000,
        },
      };

      const processor = async () => {};

      const worker1 = new Worker(queueName, processor, commontOpts);
      const worker2 = new Worker(queueName, processor, commontOpts);
      const worker3 = new Worker(queueName, processor, commontOpts);
      const worker4 = new Worker(queueName, processor, commontOpts);

      const result = new Promise<void>((resolve, reject) => {
        queueEvents.once('completed', async () => {
          resolve();
        });

        queueEvents.on('failed', async err => {
          reject(err);
        });
      });

      await delay(100);

      const jobs = Array.from(Array(numJobs).keys()).map(() => ({
        name: 'rate test',
        data: {},
      }));
      await queue.addBulk(jobs);

      await delay(100);

      await queue.pause();

      await result;

      await delay(500);

      const counts = await queue.getJobCounts('paused', 'completed', 'wait');
      expect(counts).toHaveProperty('paused', numJobs - 1);
      expect(counts).toHaveProperty('completed', 1);
      expect(counts).toHaveProperty('wait', 0);

      await worker1.close();
      await worker2.close();
      await worker3.close();
      await worker4.close();
    });
  });

  describe('when using flows', () => {
    it('should obey the rate limit per queue', { timeout: 20000 }, async () => {
      const name = 'child-job';
      const parentQueueName = `parent-queue-${v4()}`;
      const parentQueueEvents = new QueueEvents(parentQueueName, {
        connection,
        prefix,
      });
      const numJobs = 10;

      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
        },
        {
          connection,
          prefix,
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
          prefix,
          concurrency: 2,
          limiter: {
            max: 1,
            duration: 2000,
          },
        },
      );

      const flow = new FlowProducer({ connection, prefix });
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
      await flow.close();
    });
  });

  it('should obey the rate limit with max value greater than 1', async () => {
    // TODO: Move timeout to test options: { timeout: 20000 }

    const numJobs = 10;

    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
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
    it('should obey the rate limit', async () => {
      // TODO: Move timeout to test options: { timeout: 5000 }

      const numJobs = 10;
      const dynamicLimit = 250;
      const duration = 100;
      const margin = 0.95; // 5% margin for CI

      const ttl = await queue.getRateLimitTtl();
      expect(ttl).toBe(-2);

      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsStarted === 1) {
            await worker.rateLimit(dynamicLimit);
            const currentTtl = await queue.getRateLimitTtl();
            expect(currentTtl).to.be.lessThanOrEqual(250);
            expect(currentTtl).toBeGreaterThan(100);
            throw Worker.RateLimitError();
          }
        },
        {
          connection,
          prefix,
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

    describe('when job does not exist', () => {
      it('should fail with job existence error', async () => {
        const dynamicLimit = 250;
        const duration = 100;

        const worker = new Worker(
          queueName,
          async job => {
            if (job.attemptsStarted === 1) {
              await queue.rateLimit(dynamicLimit);
              await queue.obliterate({ force: true });
              throw Worker.RateLimitError();
            }
          },
          {
            autorun: false,
            concurrency: 10,
            drainDelay: 10, // If test hangs, 10 seconds here helps to fail quicker.
            limiter: {
              max: 2,
              duration,
            },
            connection,
            prefix,
          },
        );

        await worker.waitUntilReady();

        const failing = new Promise<void>(resolve => {
          worker.on('error', err => {
            expect(err.message).toBe(
              `Missing key for job ${job.id}. moveJobFromActiveToWait`,
            );
            resolve();
          });
        });

        const job = await queue.add('test', { foo: 'bar' });

        worker.run();

        await failing;
        await worker.close();
      }); // TODO: Add { timeout: 4000 } to the it() options
    });

    describe('when rate limit is too low', () => {
      it('should move job to wait anyway', async () => {
        // TODO: Move timeout to test options: { timeout: 4000 }

        const numJobs = 10;
        const dynamicLimit = 1;
        const duration = 100;

        const ttl = await queue.getRateLimitTtl();
        expect(ttl).toBe(-2);

        const worker = new Worker(
          queueName,
          async job => {
            if (job.attemptsStarted === 1) {
              delay(50);
              await worker.rateLimit(dynamicLimit);
              const currentTtl = await queue.getRateLimitTtl();
              expect(currentTtl).to.be.lessThanOrEqual(dynamicLimit);
              throw Worker.RateLimitError();
            }
          },
          {
            connection,
            prefix,
            maxStalledCount: 0,
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
              try {
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

        const jobs = Array.from(Array(numJobs).keys()).map(() => ({
          name: 'rate test',
          data: {},
        }));
        await queue.addBulk(jobs);

        await result;
        await worker.close();
      });
    });

    describe('when passing maxJobs when getting rate limit ttl', () => {
      describe('when rate limit counter is lower than maxJobs', () => {
        it('should returns 0', async () => {
          // TODO: Move timeout to test options: { timeout: 4000 }

          const numJobs = 1;
          const duration = 100;

          const ttl = await queue.getRateLimitTtl();
          expect(ttl).toBe(-2);

          const worker = new Worker(
            queueName,
            async job => {
              if (job.attemptsStarted === 1) {
                delay(50);
                const currentTtl = await queue.getRateLimitTtl(2);
                expect(currentTtl).toBe(0);
              }
            },
            {
              connection,
              prefix,
              maxStalledCount: 0,
              limiter: {
                max: 2,
                duration,
              },
            },
          );

          const result = new Promise<void>((resolve, reject) => {
            queueEvents.on(
              'completed',
              // after every job has been completed
              after(numJobs, async () => {
                try {
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

          const jobs = Array.from(Array(numJobs).keys()).map(() => ({
            name: 'rate test',
            data: {},
          }));
          await queue.addBulk(jobs);

          await result;
          await worker.close();
        });
      });

      describe('when rate limit counter is greater than maxJobs', () => {
        it('should returns at least rate limit duration', async () => {
          // TODO: Move timeout to test options: { timeout: 4000 }

          const numJobs = 10;
          const duration = 100;

          const ttl = await queue.getRateLimitTtl();
          expect(ttl).toBe(-2);

          const worker = new Worker(
            queueName,
            async job => {
              if (job.attemptsStarted === 1) {
                delay(50);
                const currentTtl = await queue.getRateLimitTtl(1);
                expect(currentTtl).to.be.lessThanOrEqual(duration);
              }
            },
            {
              connection,
              prefix,
              maxStalledCount: 0,
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
                try {
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

          const jobs = Array.from(Array(numJobs).keys()).map(() => ({
            name: 'rate test',
            data: {},
          }));
          await queue.addBulk(jobs);

          await result;
          await worker.close();
        });
      });
    });

    describe('when reaching max attempts and we want to move the job to failed', () => {
      it('should throw Unrecoverable error', async () => {
        const dynamicLimit = 550;
        const duration = 100;

        const worker = new Worker(
          queueName,
          async job => {
            await queue.rateLimit(dynamicLimit);
            if (job.attemptsStarted >= job.opts.attempts!) {
              throw new UnrecoverableError('Unrecoverable');
            }
            throw new RateLimitError();
          },
          {
            connection,
            prefix,
            limiter: {
              max: 1,
              duration,
            },
          },
        );

        const result = new Promise<void>((resolve, reject) => {
          queueEvents.once('failed', async () => {
            try {
              const timeDiff = new Date().getTime() - startTime;
              expect(timeDiff).to.be.gte(dynamicLimit);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        const startTime = new Date().getTime();
        await queue.add(
          'rate-test',
          { foo: 'bar' },
          {
            attempts: 2,
            backoff: 1000,
          },
        );

        await result;
        await worker.close();
      });
    });

    describe('when priority is provided', () => {
      it('should obey the rate limit respecting priority', async () => {
        // TODO: Move timeout to test options: { timeout: 6000 }

        let extraCount = 3;
        let priority = 9;
        const numJobs = 4;
        const dynamicLimit = 250;
        const duration = 100;

        const worker = new Worker(
          queueName,
          async job => {
            if (job.attemptsStarted === 1) {
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
            prefix,
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
              try {
                expect(args.jobId).toBe('1');
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
        it('should get jobs in fifo order', async () => {
          // TODO: Move timeout to test options: { timeout: 6000 }

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
              prefix,
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
          expect(jobs.map(x => x.name)).toEqual(['1', '2', '3', '4']);

          await worker.close();
        });
      });

      describe('when priority is different for some jobs', () => {
        it('should get jobs in fifo order', async () => {
          // TODO: Move timeout to test options: { timeout: 6000 }

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
              prefix,
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
          expect(jobs.map(x => x.name)).toEqual(['1', '3', '2', '4']);

          await worker.close();
        });
      });
    });

    describe('when queue is paused', () => {
      it('moves job to paused', async () => {
        const dynamicLimit = 250;
        const duration = 100;

        const worker = new Worker(
          queueName,
          async job => {
            if (job.attemptsStarted === 1) {
              await queue.pause();
              await delay(150);
              await queue.rateLimit(dynamicLimit);
              throw new RateLimitError();
            }
          },
          {
            connection,
            prefix,
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
        expect(pausedCount).toBe(1);

        await worker.close();
      });
    });

    describe('when removing rate limit', () => {
      it('should process jobs normally', async () => {
        // TODO: Move timeout to test options: { timeout: 5000 }

        const numJobs = 2;
        const dynamicLimit = 10000;
        const duration = 1000;

        const ttl = await queue.getRateLimitTtl();
        expect(ttl).toBe(-2);

        const worker = new Worker(queueName, async () => {}, {
          autorun: false,
          connection,
          prefix,
          limiter: {
            max: 1,
            duration,
          },
        });

        await worker.rateLimit(dynamicLimit);

        await queue.removeRateLimitKey();
        const result = new Promise<void>((resolve, reject) => {
          queueEvents.on(
            'completed',
            // after every job has been completed
            after(numJobs, async () => {
              try {
                const timeDiff = new Date().getTime() - startTime;
                expect(timeDiff).to.be.gte((numJobs - 1) * duration);
                expect(timeDiff).to.be.lte(numJobs * duration);
                resolve();
              } catch (err) {
                reject(err);
              }
            }),
          );

          queueEvents.on('failed', async err => {
            reject(err);
          });
        });

        const startTime = new Date().getTime();
        const jobs = Array.from(Array(numJobs).keys()).map(() => ({
          name: 'rate test',
          data: {},
        }));
        await queue.addBulk(jobs);

        worker.run();
        await result;
        await worker.close();
      });

      describe('when maximumRateLimitDelay is reached', () => {
        it('should continue processing jobs', async () => {
          // TODO: Move timeout to test options: { timeout: 50000 }

          const numJobs = 4;
          const duration = 10000;

          const worker = new Worker(queueName, async () => {}, {
            autorun: false,
            connection,
            maximumRateLimitDelay: 3000,
            prefix,
          });
          await queue.setGlobalRateLimit(1, duration);

          const completing = new Promise<void>((resolve, reject) => {
            worker.on(
              'completed',
              after(numJobs, async () => {
                resolve();
              }),
            );
          });

          const jobs = Array.from(Array(numJobs).keys()).map(() => ({
            name: 'rate test',
            data: {},
          }));
          await queue.addBulk(jobs);

          const waitingCountBeforeRun = await queue.getWaitingCount();
          expect(waitingCountBeforeRun).toBe(4);

          worker.run();

          await delay(1500);
          await queue.removeGlobalRateLimit();
          await delay(1500);

          await completing;

          const completedCountAfterRLRemoval = await queue.getCompletedCount();
          expect(completedCountAfterRLRemoval).toBe(4);

          await worker.close();
        });
      });
    });
  });

  describe('when there are delayed jobs to promote', () => {
    it('should promote jobs after maximumRateLimitDelay', async () => {
      // TODO: Move timeout to test options: { timeout: 5000 }

      const numJobs = 2;
      const duration = 10000;

      const ttl = await queue.getRateLimitTtl();
      expect(ttl).toBe(-2);

      const worker = new Worker(queueName, async () => {}, {
        autorun: false,
        connection,
        maximumRateLimitDelay: 3000,
        prefix,
        limiter: {
          max: 1,
          duration,
        },
      });

      const jobs = Array.from(Array(numJobs).keys()).map(() => ({
        name: 'rate test',
        data: {},
      }));
      await queue.addBulk(jobs);

      const delayedJobs = Array.from(Array(numJobs).keys()).map(() => ({
        name: 'delayed test',
        data: {},
        opts: { delay: 1500 },
      }));
      await queue.addBulk(delayedJobs);

      const waitingCountBeforeRun = await queue.getWaitingCount();
      expect(waitingCountBeforeRun).toBe(2);
      const delayedCountBeforeRun = await queue.getDelayedCount();
      expect(delayedCountBeforeRun).toBe(2);

      worker.run();

      await delay(3100);

      const waitingCountAfterMaxRLDelay = await queue.getWaitingCount();
      expect(waitingCountAfterMaxRLDelay).toBe(3);
      const delayedCountAfterMaxRLDelay = await queue.getDelayedCount();
      expect(delayedCountAfterMaxRLDelay).toBe(0);

      await worker.close();
    });
  });

  describe('when there are more added jobs than max limiter', () => {
    it('processes jobs as max limiter from the beginning', async () => {
      const numJobs = 400;
      // TODO: Move timeout to test options: { timeout: 5000 }
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
        prefix,
      });

      const allCompleted = new Promise(resolve => {
        worker.on('completed', after(numJobs, resolve));
      });

      const jobs = Array(numJobs)
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
      it('processes jobs as max limiter from the beginning', async () => {
        const numJobs = 5;
        // TODO: Move timeout to test options: { timeout: 8000 }
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
          prefix,
        });

        const allCompleted = new Promise(resolve => {
          worker.on('completed', after(numJobs, resolve));
        });

        const jobs = Array(numJobs)
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

  it('should obey priority', async () => {
    // TODO: Move timeout to test options: { timeout: 10000 }

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

        priorityBuckets[priority!] = priorityBuckets[priority!] - 1;

        for (let p = 1; p < priority!; p++) {
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
        prefix,
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
