import { default as IORedis } from 'ioredis';
import {
  FlowProducer,
  QueueEvents,
  Queue,
  Worker,
  RateLimitError,
} from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';
import { beforeEach, describe, it, after as afterAll } from 'mocha';
import { v4 } from 'uuid';
import { expect } from 'chai';
import * as ProgressBar from 'progress';
import { after } from 'lodash';

describe('Concurrency', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  let queueName: string;

  let connection;
  before(async function () {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    await new IORedis().flushall();
  });

  afterEach(async () => {
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  it('should run max concurrency for jobs added', async () => {
    const queue = new Queue(queueName, { connection, prefix });
    const numJobs = 15;
    const jobsData: { name: string; data: any }[] = [];
    for (let j = 0; j < numJobs; j++) {
      jobsData.push({
        name: 'test',
        data: { foo: `bar${j}` },
      });
    }

    const noConcurrency = await queue.getGlobalConcurrency();
    expect(noConcurrency).to.be.null;

    await queue.addBulk(jobsData);
    await queue.setGlobalConcurrency(1);
    const bar = new ProgressBar(':bar', { total: numJobs });

    let count = 0;
    let parallelJobs = 0;
    let lastJobId = 0;
    let worker: Worker;
    const processing = new Promise<void>((resolve, reject) => {
      worker = new Worker(
        queueName,
        async job => {
          try {
            // Check order is correct
            expect(job.id).to.be.eq(`${++lastJobId}`);
            count++;
            parallelJobs++;
            await delay(100);
            bar.tick();
            parallelJobs--;
            expect(parallelJobs).to.be.eql(0);
            if (count == numJobs) {
              resolve();
            }
          } catch (err) {
            console.log(err);
            reject(err);
            throw err;
          }
        },
        {
          autorun: false,
          concurrency: 10,
          drainDelay: 10, // If test hangs, 10 seconds here helps to fail quicker.
          connection,
          prefix,
        },
      );
      worker.on('error', err => {
        console.error(err);
      });
    });
    await worker.waitUntilReady();

    worker.run();

    await processing;

    const globalConcurrency = await queue.getGlobalConcurrency();
    expect(globalConcurrency).to.be.eql(1);

    await worker.close();
    await queue.close();
  }).timeout(16000);

  it('should run max concurrency for jobs added', async () => {
    const queue = new Queue(queueName, { connection, prefix });
    const numJobs = 16;
    const jobsData: { name: string; data: any }[] = [];
    for (let j = 0; j < numJobs; j++) {
      jobsData.push({
        name: 'test',
        data: { foo: `bar${j}` },
      });
    }

    await queue.addBulk(jobsData);
    await queue.setGlobalConcurrency(1);
    await queue.removeGlobalConcurrency();
    const bar = new ProgressBar(':bar', { total: numJobs });

    let count = 0;
    let parallelJobs = 0;
    let lastJobId = 0;
    let worker: Worker;
    const processing = new Promise<void>((resolve, reject) => {
      worker = new Worker(
        queueName,
        async job => {
          try {
            // Check order is correct
            expect(job.id).to.be.eq(`${++lastJobId}`);
            count++;
            parallelJobs++;
            await delay(100);
            expect(parallelJobs).to.be.eql(2);
            await delay(100);
            bar.tick();
            parallelJobs--;
            if (count == numJobs) {
              resolve();
            }
          } catch (err) {
            console.log(err);
            reject(err);
            throw err;
          }
        },
        {
          autorun: false,
          concurrency: 2,
          drainDelay: 10, // If test hangs, 10 seconds here helps to fail quicker.
          connection,
          prefix,
        },
      );
      worker.on('error', err => {
        console.error(err);
      });
    });
    await worker.waitUntilReady();

    worker.run();

    await processing;

    const globalConcurrency = await queue.getGlobalConcurrency();
    expect(globalConcurrency).to.be.null;

    await worker.close();
    await queue.close();
  }).timeout(4000);

  it('emits drained global event only once when worker is idle', async function () {
    const queue = new Queue(queueName, { connection, prefix });
    const worker = new Worker(
      queueName,
      async () => {
        await delay(25);
      },
      {
        concurrency: 10,
        drainDelay: 1,
        connection,
        prefix,
      },
    );

    let counterDrainedEvents = 0;

    const queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();
    queueEvents.on('drained', () => {
      counterDrainedEvents++;
    });

    await queue.addBulk([
      { name: 'test', data: { foo: 'bar' } },
      { name: 'test', data: { foo: 'baz' } },
    ]);
    await queue.setGlobalConcurrency(1);

    await delay(4000);

    const jobs = await queue.getJobCountByTypes('completed');
    expect(jobs).to.be.equal(2);
    expect(counterDrainedEvents).to.be.equal(1);

    await worker.close();
    await queue.close();
    await queueEvents.close();
  }).timeout(6000);

  describe('when global dynamic limit is used', () => {
    it('should run max concurrency for jobs added respecting global dynamic limit', async () => {
      const numJobs = 5;
      const dynamicLimit = 250;
      const duration = 100;

      const queue = new Queue(queueName, {
        connection,
        prefix,
      });
      const queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();
      await queue.setGlobalConcurrency(1);

      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsStarted === 1) {
            await queue.rateLimit(dynamicLimit);
            throw new RateLimitError();
          }
        },
        {
          autorun: false,
          concurrency: 10,
          drainDelay: 10, // If test hangs, 10 seconds here helps to fail quicker.
          limiter: {
            max: 1,
            duration,
          },
          connection,
          prefix,
        },
      );
      worker.on('error', err => {
        console.error(err);
      });
      await worker.waitUntilReady();

      const startTime = new Date().getTime();

      const result = new Promise<void>((resolve, reject) => {
        queueEvents.on(
          'completed',
          // after every job has been completed
          after(numJobs, async () => {
            try {
              const timeDiff = new Date().getTime() - startTime;
              expect(timeDiff).to.be.gte(
                numJobs * (dynamicLimit + duration) - duration,
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

      const jobsData: { name: string; data: any }[] = [];
      for (let j = 0; j < numJobs; j++) {
        jobsData.push({
          name: 'test',
          data: { foo: `bar${j}` },
        });
      }

      await queue.addBulk(jobsData);

      worker.run();

      await result;
      await queueEvents.close();
      await worker.close();
      await queue.close();
    });

    describe('when max limiter is greater than 1', () => {
      it('should run max concurrency for jobs added first processed', async () => {
        const numJobs = 10;
        const dynamicLimit = 250;
        const duration = 100;

        const queue = new Queue(queueName, {
          connection,
          prefix,
        });
        const queueEvents = new QueueEvents(queueName, { connection, prefix });
        await queueEvents.waitUntilReady();
        await queue.setGlobalConcurrency(1);

        const worker = new Worker(
          queueName,
          async job => {
            if (job.attemptsStarted === 1) {
              await queue.rateLimit(dynamicLimit);
              throw new RateLimitError();
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
        worker.on('error', err => {
          console.error(err);
        });
        await worker.waitUntilReady();

        const startTime = new Date().getTime();

        const result = new Promise<void>((resolve, reject) => {
          queueEvents.on(
            'completed',
            // after every job has been completed
            after(numJobs, async () => {
              try {
                const timeDiff = new Date().getTime() - startTime;
                expect(timeDiff).to.be.gte(numJobs * dynamicLimit);
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

        const jobsData: { name: string; data: any }[] = [];
        for (let j = 0; j < numJobs; j++) {
          jobsData.push({
            name: 'test',
            data: { foo: `bar${j}` },
          });
        }

        await queue.addBulk(jobsData);

        worker.run();

        await result;
        await queueEvents.close();
        await worker.close();
        await queue.close();
      }).timeout(4000);
    });
  });

  describe('when moving job to waiting-children', () => {
    it('should run max concurrency for jobs added first processed', async () => {
      const numJobs = 5;
      const flow = new FlowProducer({ connection, prefix });
      const queue = new Queue(queueName, {
        connection,
        prefix,
      });

      const jobsData: { name: string; data: any }[] = [];
      for (let j = 0; j < numJobs; j++) {
        jobsData.push({
          name: 'test',
          data: { foo: `bar${j}` },
        });
      }

      await queue.addBulk(jobsData);
      await queue.setGlobalConcurrency(1);

      const name = 'child-job';

      await flow.add({
        name: 'parent-job',
        queueName,
        data: {},
        children: [
          {
            name,
            data: { idx: 0, foo: 'bar' },
            queueName,
            children: [
              {
                name,
                data: { idx: 0, foo: 'bar' },
                queueName,
              },
            ],
          },
        ],
      });

      const bar = new ProgressBar(':bar', {
        total: numJobs + 3,
      });

      let count = 0;
      let parallelJobs = 0;
      let worker: Worker;
      const processing = new Promise<void>((resolve, reject) => {
        worker = new Worker(
          queueName,
          async (job, token) => {
            try {
              count++;
              parallelJobs++;
              await delay(100);
              bar.tick();
              parallelJobs--;
              expect(parallelJobs).to.be.eql(0);
              await job.moveToWaitingChildren(token!);
              if (count == numJobs + 3) {
                resolve();
              }
            } catch (err) {
              reject(err);
              throw err;
            }
          },
          {
            autorun: false,
            concurrency: 10,
            drainDelay: 10, // If test hangs, 10 seconds here helps to fail quicker.
            connection,
            prefix,
          },
        );
        worker.on('error', err => {
          console.error(err);
        });
      });
      await worker.waitUntilReady();

      worker.run();

      await processing;
      await flow.close();
      await worker.close();
      await queue.close();
    }).timeout(16000);
  });

  it('should automatically process stalled jobs respecting group order', async () => {
    const numJobs = 4;
    const globalConcurrency = 2;
    const queue = new Queue(queueName, {
      connection,
      prefix,
    });

    for (let j = 0; j < numJobs; j++) {
      await queue.add('test-stalled', { foo: j % 2 });
    }
    await queue.setGlobalConcurrency(globalConcurrency);

    const concurrency = 4;

    const worker = new Worker(
      queueName,
      async () => {
        return delay(10000);
      },
      {
        autorun: false,
        connection,
        lockDuration: 1000,
        stalledInterval: 100,
        concurrency,
        prefix,
      },
    );

    const allActive = new Promise(resolve => {
      worker.on('active', after(globalConcurrency, resolve));
    });

    worker.run();

    await allActive;

    await worker.close(true);

    const processedJobs: { data: any }[] = [];

    const worker2 = new Worker(
      queueName,
      async job => {
        await delay(10);
        processedJobs.push({ data: job.data.foo });
      },
      {
        autorun: false,
        connection,
        concurrency,
        stalledInterval: 100,
        prefix,
      },
    );

    const allCompleted = new Promise(resolve => {
      worker2.on('completed', after(numJobs, resolve));
    });

    worker2.on('error', error => {
      console.log('error');
    });

    const allStalled = new Promise<void>(resolve => {
      worker2.on(
        'stalled',
        after(globalConcurrency, (jobId, prev) => {
          expect(prev).to.be.equal('active');
          resolve();
        }),
      );
    });

    worker2.run();
    await allStalled;

    await allCompleted;

    await worker2.close();
    await queue.close();

    let index = 0,
      sum = 0;
    for (let i = 1; i <= numJobs; i++) {
      const job = processedJobs[index++];
      sum += Number(job.data);
      if (i % 2 == 0) {
        expect(sum).to.be.equal(1);
        sum = 0;
      }
    }
  });

  describe('when jobs use backoff strategy', () => {
    it('processes jobs without getting stuck', async () => {
      const numJobs = 2;
      const globalConcurrency = 1;
      const queue = new Queue(queueName, {
        connection,
        prefix,
      });

      for (let j = 0; j < numJobs; j++) {
        await queue.add(
          'test',
          { foo: `bar${j}` },
          { attempts: 2, backoff: 100 },
        );
      }
      await queue.setGlobalConcurrency(globalConcurrency);

      const concurrency = 10;

      let worker: Worker;
      const processedJobs: { data: any }[] = [];
      const processing = new Promise<void>(resolve => {
        worker = new Worker(
          queueName,
          async job => {
            await delay(25);
            if (job.attemptsStarted == 1) {
              throw new Error('Not yet!');
            }

            processedJobs.push({ data: job.data });
            if (processedJobs.length == numJobs) {
              resolve();
            }
          },
          {
            connection,
            concurrency,
            prefix,
          },
        );
      });

      await processing;

      expect(processedJobs.length).to.be.equal(numJobs);

      await worker.close();
      await queue.close();
    }).timeout(20000);

    describe('when backoff is 0', () => {
      it('processes jobs without getting stuck', async () => {
        const numJobs = 7;
        const globalConcurrency = 1;
        const queue = new Queue(queueName, {
          connection,
          prefix,
        });

        for (let j = 0; j < numJobs; j++) {
          await queue.add(
            'test',
            { foo: `bar${j}` },
            { attempts: 2, backoff: 0 },
          );
        }
        await queue.setGlobalConcurrency(globalConcurrency);

        const concurrency = 4;

        let worker: Worker;
        const processedJobs: { data: any }[] = [];
        const processing = new Promise<void>(resolve => {
          worker = new Worker(
            queueName,
            async job => {
              await delay(20);
              if (job.attemptsStarted == 1) {
                throw new Error('Not yet!');
              }

              processedJobs.push({ data: job.data });
              if (processedJobs.length == numJobs) {
                resolve();
              }
            },
            {
              connection,
              concurrency,
              prefix,
            },
          );
        });

        await processing;

        expect(processedJobs.length).to.be.equal(numJobs);

        await worker.close();
        await queue.close();
      });
    });
  });

  describe('when lock is expired and removing a job in active state', () => {
    it('does not get stuck in max state', async function () {
      const globalConcurrency = 1;
      const queue = new Queue(queueName, {
        connection,
        prefix,
      });
      await queue.waitUntilReady();
      await queue.setGlobalConcurrency(globalConcurrency);
      const worker = new Worker(queueName, null, {
        connection,
        lockRenewTime: 200,
        lockDuration: 20,
        skipStalledCheck: true,
        skipLockRenewal: true,
        prefix,
      });
      const token = 'my-token';
      const numJobs = 4;
      for (let j = 0; j < numJobs; j++) {
        await queue.add('test', { foo: `bar${j}` });
      }
      const job1 = await worker.getNextJob(token);
      const state = await job1!.getState();
      expect(state).to.be.equal('active');
      await delay(50);
      let isMaxed = await queue.isMaxed();
      expect(isMaxed).to.be.true;
      await job1!.remove();
      isMaxed = await queue.isMaxed();
      expect(isMaxed).to.be.false;
      await worker.close();
      await queue.close();
    });
  });
});
