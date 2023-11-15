import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { after, times } from 'lodash';
import { describe, beforeEach, it, before, after as afterAll } from 'mocha';
import * as sinon from 'sinon';
import { v4 } from 'uuid';
import {
  Queue,
  QueueEvents,
  Job,
  UnrecoverableError,
  Worker,
  WaitingChildrenError,
  DelayedError,
} from '../src/classes';
import { KeepJobs, MinimalJob } from '../src/interfaces';
import { JobsOptions } from '../src/types';
import {
  delay,
  isRedisVersionLowerThan,
  removeAllQueueData,
} from '../src/utils';

describe('workers', function () {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  const sandbox = sinon.createSandbox();

  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  let connection;
  before(async function () {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(async function () {
    sandbox.restore();
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('when closing a worker', () => {
    it('process a job that throws an exception after worker close', async () => {
      const jobError = new Error('Job Failed');

      const worker = new Worker(
        queueName,
        async job => {
          expect(job.data.foo).to.be.equal('bar');
          await delay(3000);
          throw jobError;
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      expect(job.id).to.be.ok;
      expect(job.data.foo).to.be.eql('bar');

      await delay(100);
      /* Try to gracefully close while having a job that will be failed running */
      worker.close();

      await new Promise<void>(resolve => {
        worker.once('failed', async (job, err) => {
          expect(job).to.be.ok;
          expect(job.data.foo).to.be.eql('bar');
          expect(err).to.be.eql(jobError);
          resolve();
        });
      });

      const count = await queue.getJobCounts('active', 'failed');
      expect(count.active).to.be.eq(0);
      expect(count.failed).to.be.eq(1);
    });

    it('process a job that complete after worker close', async () => {
      const worker = new Worker(
        queueName,
        async job => {
          expect(job.data.foo).to.be.equal('bar');
          await delay(3000);
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const job = await queue.add('test', { foo: 'bar' });

      expect(job.id).to.be.ok;
      expect(job.data.foo).to.be.eql('bar');

      await delay(100);
      /* Try to gracefully close while having a job that will be completed running */
      worker.close();

      await new Promise<void>(resolve => {
        worker.once('completed', async job => {
          expect(job).to.be.ok;
          expect(job.finishedOn).to.be.a('number');
          expect(job.data.foo).to.be.eql('bar');
          resolve();
        });
      });

      const count = await queue.getJobCounts('active', 'completed');
      expect(count.active).to.be.eq(0);
      expect(count.completed).to.be.eq(1);
    });
  });

  describe('when sharing connection', () => {
    it('should not fail', async () => {
      const queueName2 = `test-${v4()}`;

      const connection = new IORedis({
        host: redisHost,
        maxRetriesPerRequest: null,
      });

      const queue1 = new Queue(queueName2, { connection, prefix });

      let counter = 1;
      const maxJobs = 35;

      let processor;
      const processing = new Promise<void>((resolve, reject) => {
        processor = async (job: Job) => {
          try {
            expect(job.data.num).to.be.equal(counter);
            expect(job.data.foo).to.be.equal('bar');
            if (counter === maxJobs) {
              resolve();
            }
            counter++;
          } catch (err) {
            reject(err);
          }
        };
      });

      const worker = new Worker(queueName2, processor, { connection, prefix });
      await worker.waitUntilReady();

      for (let i = 1; i <= maxJobs; i++) {
        await queue1.add('test', { foo: 'bar', num: i });
      }

      await processing;
      expect(worker.isRunning()).to.be.equal(true);

      await worker.close();
      await queue1.close();
      await removeAllQueueData(new IORedis(redisHost), queueName2);
    });
  });

  describe('auto job removal', () => {
    async function testRemoveOnFinish(
      opts: boolean | number | KeepJobs,
      expectedCount: number,
      fail?: boolean,
    ) {
      const clock = sinon.useFakeTimers();
      clock.reset();

      const worker = new Worker(
        queueName,
        async job => {
          await job.log('test log');
          if (fail) {
            throw new Error('job failed');
          }
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const datas = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

      let jobIds;

      const processing = new Promise<void>(resolve => {
        worker.on(fail ? 'failed' : 'completed', async job => {
          clock.tick(1000);

          if (job.data == 14) {
            const counts = await queue.getJobCounts(
              fail ? 'failed' : 'completed',
            );

            if (fail) {
              expect(counts.failed).to.be.equal(expectedCount);
            } else {
              expect(counts.completed).to.be.equal(expectedCount);
            }

            await Promise.all(
              jobIds.map(async (jobId, index) => {
                const job = await queue.getJob(jobId);
                const logs = await queue.getJobLogs(jobId);
                if (index >= datas.length - expectedCount) {
                  expect(job).to.not.be.equal(undefined);
                  expect(logs.logs).to.not.be.empty;
                } else {
                  expect(job).to.be.equal(undefined);
                  expect(logs.logs).to.be.empty;
                }
              }),
            );
            resolve();
          }
        });
      });

      const jobOpts: JobsOptions = {};
      if (fail) {
        jobOpts.removeOnFail = opts;
      } else {
        jobOpts.removeOnComplete = opts;
      }

      jobIds = (
        await Promise.all(
          datas.map(async data => queue.add('test', data, jobOpts)),
        )
      ).map(job => job.id);

      await processing;
      clock.restore();
      await worker.close();
    }

    async function testWorkerRemoveOnFinish(
      opts: KeepJobs,
      expectedCount: number,
      fail?: boolean,
    ) {
      const clock = sinon.useFakeTimers();
      clock.reset();

      const worker = new Worker(
        queueName,
        async job => {
          await job.log('test log');
          if (fail) {
            throw new Error('job failed');
          }
        },
        {
          connection,
          prefix,
          ...(fail ? { removeOnFail: opts } : { removeOnComplete: opts }),
        },
      );
      await worker.waitUntilReady();

      const datas = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

      let jobIds;

      const processing = new Promise<void>(resolve => {
        worker.on(fail ? 'failed' : 'completed', async job => {
          clock.tick(1000);

          if (job.data == 14) {
            const counts = await queue.getJobCounts(
              fail ? 'failed' : 'completed',
            );

            if (fail) {
              expect(counts.failed).to.be.equal(expectedCount);
            } else {
              expect(counts.completed).to.be.equal(expectedCount);
            }

            await Promise.all(
              jobIds.map(async (jobId, index) => {
                const job = await queue.getJob(jobId);
                const logs = await queue.getJobLogs(jobId);
                if (index >= datas.length - expectedCount) {
                  expect(job).to.not.be.equal(undefined);
                  expect(logs.logs).to.not.be.empty;
                } else {
                  expect(job).to.be.equal(undefined);
                  expect(logs.logs).to.be.empty;
                }
              }),
            );
            resolve();
          }
        });
      });

      jobIds = (
        await Promise.all(datas.map(async data => queue.add('test', data)))
      ).map(job => job.id);

      await processing;
      clock.restore();
      await worker.close();
    }

    it('should remove job after completed if removeOnComplete', async () => {
      const worker = new Worker(
        queueName,
        async (job, token) => {
          expect(token).to.be.string;
          expect(job.data.foo).to.be.equal('bar');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const job = await queue.add(
        'test',
        { foo: 'bar' },
        { removeOnComplete: true },
      );
      expect(job.id).to.be.ok;
      expect(job.data.foo).to.be.eql('bar');

      const completed = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job) => {
          try {
            expect(job.finishedOn).to.be.string;
            const gotJob = await queue.getJob(job.id);
            expect(gotJob).to.be.equal(undefined);
            const counts = await queue.getJobCounts('completed');
            expect(counts.completed).to.be.equal(0);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await completed;

      await worker.close();
    });

    it('should remove a job after completed if the default job options specify removeOnComplete', async () => {
      const newQueue = new Queue(queueName, {
        connection,
        prefix,
        defaultJobOptions: {
          removeOnComplete: true,
        },
      });

      const worker = new Worker(
        queueName,
        async job => {
          expect(job.data.foo).to.be.equal('bar');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const job = await newQueue.add('test', { foo: 'bar' });
      expect(job.id).to.be.ok;
      expect(job.data.foo).to.be.eql('bar');

      await new Promise<void>((resolve, reject) => {
        worker.on('completed', async job => {
          try {
            const gotJob = await newQueue.getJob(job.id);
            expect(gotJob).to.be.equal(undefined);
            const counts = await newQueue.getJobCounts('completed');
            expect(counts.completed).to.be.equal(0);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await worker.close();
      await newQueue.close();
    });

    it('should keep specified number of jobs after completed with removeOnComplete', async () => {
      const keepJobs = 3;
      await testRemoveOnFinish(keepJobs, keepJobs);
    });

    it('should keep of jobs newer than specified after completed with removeOnComplete', async () => {
      const age = 7;
      await testRemoveOnFinish({ age }, age);
    });

    it('should keep of jobs newer than specified and up to a count completed with removeOnComplete', async () => {
      const age = 7;
      const count = 5;
      await testRemoveOnFinish({ age, count }, count);
    });

    it('should keep of jobs newer than specified and up to a count fail with removeOnFail', async () => {
      const age = 7;
      const count = 5;
      await testRemoveOnFinish({ age, count }, count, true);
    });

    it('should keep specified number of jobs after completed with default job options removeOnComplete', async () => {
      const keepJobs = 3;

      const newQueue = new Queue(queueName, {
        connection,
        prefix,
        defaultJobOptions: {
          removeOnComplete: keepJobs,
        },
      });

      const worker = new Worker(
        queueName,
        async job => {
          await job.log('test log');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const datas = [0, 1, 2, 3, 4, 5, 6, 7, 8];

      const jobIds = await Promise.all(
        datas.map(async data => (await newQueue.add('test', data)).id),
      );

      return new Promise((resolve, reject) => {
        worker.on('completed', async job => {
          if (job.data == 8) {
            try {
              const counts = await newQueue.getJobCounts('completed');
              expect(counts.completed).to.be.equal(keepJobs);

              await Promise.all(
                jobIds.map(async (jobId, index) => {
                  const job = await newQueue.getJob(jobId);
                  if (index >= datas.length - keepJobs) {
                    expect(job).to.not.be.equal(undefined);
                  } else {
                    expect(job).to.be.equal(undefined);
                  }
                }),
              );
            } catch (err) {
              reject(err);
            } finally {
              await worker.close();
              await newQueue.close();
            }
            resolve();
          }
        });
      });
    });

    it('should remove job after failed if removeOnFail', async () => {
      await testRemoveOnFinish(true, 0, true);
    });

    it('should remove a job after fail if the default job options specify removeOnFail', async () => {
      const worker = new Worker(
        queueName,
        async job => {
          expect(job.data.foo).to.be.equal('bar');
          throw Error('error');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const newQueue = new Queue(queueName, {
        connection,
        prefix,
        defaultJobOptions: {
          removeOnFail: true,
        },
      });

      const job = await newQueue.add('test', { foo: 'bar' });
      expect(job.id).to.be.ok;
      expect(job.data.foo).to.be.eql('bar');

      await new Promise<void>(resolve => {
        worker.on('failed', async job => {
          const currentJob = await newQueue.getJob(job.id);
          expect(currentJob).to.be.equal(undefined);
          const counts = await newQueue.getJobCounts('completed');
          expect(counts.completed).to.be.equal(0);
          resolve();
        });
      });

      await worker.close();
      await newQueue.close();
    });

    it('should keep specified number of jobs after completed with removeOnFail', async () => {
      const keepJobs = 3;
      await testRemoveOnFinish(keepJobs, keepJobs, true);
    });

    it('should keep specified number of jobs after completed with global removeOnFail', async () => {
      const keepJobs = 3;

      const worker = new Worker(
        queueName,
        async job => {
          expect(job.data.foo).to.be.equal('bar');
          throw Error('error');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const newQueue = new Queue(queueName, {
        connection,
        prefix,
        defaultJobOptions: {
          removeOnFail: keepJobs,
        },
      });

      const datas = [0, 1, 2, 3, 4, 5, 6, 7, 8];

      const jobIds = await Promise.all(
        datas.map(async data => (await newQueue.add('test', data)).id),
      );

      return new Promise<void>((resolve, reject) => {
        worker.on('failed', async job => {
          if (job.data == 8) {
            try {
              const counts = await newQueue.getJobCounts('failed');
              expect(counts.failed).to.be.equal(keepJobs);

              await Promise.all(
                jobIds.map(async (jobId, index) => {
                  const job = await newQueue.getJob(jobId);
                  if (index >= datas.length - keepJobs) {
                    expect(job).to.not.be.equal(undefined);
                  } else {
                    expect(job).to.be.equal(undefined);
                  }
                }),
              );
            } catch (err) {
              reject(err);
            }
            await worker.close();
            await newQueue.close();
            resolve();
          }
        });
      });
    });

    describe('when worker has removeOnFinish options', () => {
      it('should keep of jobs newer than specified after completed with removeOnComplete', async () => {
        const age = 7;
        await testWorkerRemoveOnFinish({ age }, age);
      });

      it('should keep of jobs newer than specified and up to a count completed with removeOnComplete', async () => {
        const age = 7;
        const count = 5;
        await testWorkerRemoveOnFinish({ age, count }, count);
      });

      it('should keep of jobs newer than specified and up to a count fail with removeOnFail', async () => {
        const age = 7;
        const count = 5;
        await testWorkerRemoveOnFinish({ age, count }, count, true);
      });
    });
  });

  it('process a lifo queue', async function () {
    this.timeout(3000);
    let currentValue = 0;
    let first = true;

    let processor;
    const processing = new Promise<void>((resolve, reject) => {
      processor = async (job: Job) => {
        try {
          expect(job.data.count).to.be.equal(currentValue--);
        } catch (err) {
          reject(err);
        }

        if (first) {
          first = false;
        } else if (currentValue === 0) {
          resolve();
        }
      };
    });

    const worker = new Worker(queueName, processor, { connection, prefix });
    await worker.waitUntilReady();

    await queue.pause();
    // Add a series of jobs in a predictable order
    const jobs = [
      { count: ++currentValue },
      { count: ++currentValue },
      { count: ++currentValue },
      { count: ++currentValue },
    ];
    await Promise.all(
      jobs.map(jobData => {
        return queue.add('test', jobData, { lifo: true });
      }),
    );
    await queue.resume();

    await processing;

    await worker.close();
  });

  it('should process jobs by priority', async () => {
    const normalPriority: Promise<Job>[] = [];
    const mediumPriority: Promise<Job>[] = [];
    const highPriority: Promise<Job>[] = [];

    let processor;

    // for the current strategy this number should not exceed 8 (2^2*2)
    // this is done to maintain a deterministic output.
    const numJobsPerPriority = 6;

    for (let i = 0; i < numJobsPerPriority; i++) {
      normalPriority.push(queue.add('test', { p: 2 }, { priority: 2 }));
      mediumPriority.push(queue.add('test', { p: 3 }, { priority: 3 }));
      highPriority.push(queue.add('test', { p: 1 }, { priority: 1 }));
    }

    let currentPriority = 1;
    let counter = 0;
    let total = 0;

    const processing = new Promise<void>((resolve, reject) => {
      processor = async (job: Job) => {
        try {
          expect(job.id).to.be.ok;
          expect(job.data.p).to.be.eql(currentPriority);
        } catch (err) {
          reject(err);
        }

        total++;
        if (++counter === numJobsPerPriority) {
          currentPriority++;
          counter = 0;

          if (currentPriority === 4 && total === numJobsPerPriority * 3) {
            resolve();
          }
        }
      };
    });

    const worker = new Worker(queueName, processor, { connection, prefix });
    await worker.waitUntilReady();

    // wait for all jobs to enter the queue and then start processing
    await Promise.all([normalPriority, mediumPriority, highPriority]);

    await processing;

    await worker.close();
  });

  describe('when prioritized job is added while processing last active job', () => {
    it('should process prioritized job whithout delay', async function () {
      this.timeout(1000);
      await queue.add('test1', { p: 2 }, { priority: 2 });
      let counter = 0;
      let processor;
      const processing = new Promise<void>((resolve, reject) => {
        processor = async (job: Job) => {
          try {
            if (job.name == 'test1') {
              await queue.add('test', { p: 2 }, { priority: 2 });
            }

            expect(job.id).to.be.ok;
            expect(job.data.p).to.be.eql(2);
          } catch (err) {
            reject(err);
          }

          if (++counter === 2) {
            resolve();
          }
        };
      });

      const worker = new Worker(queueName, processor, { connection, prefix });
      await worker.waitUntilReady();

      await processing;

      await worker.close();
    });
  });

  it('process several jobs serially', async () => {
    let counter = 1;
    const maxJobs = 35;

    let processor;
    const processing = new Promise<void>((resolve, reject) => {
      processor = async (job: Job) => {
        try {
          expect(job.data.num).to.be.equal(counter);
          expect(job.data.foo).to.be.equal('bar');
          if (counter === maxJobs) {
            resolve();
          }
          counter++;
        } catch (err) {
          reject(err);
        }
      };
    });

    const worker = new Worker(queueName, processor, { connection, prefix });
    await worker.waitUntilReady();

    for (let i = 1; i <= maxJobs; i++) {
      await queue.add('test', { foo: 'bar', num: i });
    }

    await processing;
    expect(worker.isRunning()).to.be.equal(true);

    await worker.close();
  });

  describe('when sharing a redis connection between workers', function () {
    it('should not close the connection', async () => {
      const connection = new IORedis(redisHost, { maxRetriesPerRequest: null });

      return new Promise((resolve, reject) => {
        connection.on('ready', async () => {
          const worker1 = new Worker('test-shared', null, {
            connection,
            prefix,
          });
          const worker2 = new Worker('test-shared', null, {
            connection,
            prefix,
          });

          try {
            // There is no point into checking the ready status after closing
            // since ioredis will not update it anyway:
            // https://github.com/luin/ioredis/issues/614
            expect(connection.status).to.be.equal('ready');
            await worker1.close();
            await worker2.close();
            await connection.quit();

            connection.on('end', () => {
              resolve();
            });
          } catch (err) {
            reject(err);
          }
        });
      });
    });

    it('should not close the connection', async () => {
      const connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
      const queueName2 = `test-shared-${v4()}`;

      const queue2 = new Queue(queueName2, {
        defaultJobOptions: { removeOnComplete: true },
        connection,
        prefix,
      });

      await new Promise<void>((resolve, reject) => {
        connection.on('ready', async () => {
          const worker1 = new Worker(queueName2, null, { connection, prefix });
          const worker2 = new Worker(queueName2, null, { connection, prefix });

          try {
            // There is no point into checking the ready status after closing
            // since ioredis will not update it anyway:
            // https://github.com/luin/ioredis/issues/614
            expect(connection.status).to.be.equal('ready');
            await worker1.close();
            await worker2.close();
            await connection.quit();

            connection.on('end', () => {
              resolve();
            });
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue2.close();
      await removeAllQueueData(new IORedis(redisHost), queueName2);
    });
  });

  describe('when autorun option is provided as false', function () {
    it('processes several jobs serially using process option as false', async () => {
      let counter = 1;
      const maxJobs = 10;

      let processor;
      const processing = new Promise<void>((resolve, reject) => {
        processor = async (job: Job) => {
          try {
            expect(job.data.num).to.be.equal(counter);
            expect(job.data.foo).to.be.equal('bar');
            if (counter === maxJobs) {
              resolve();
            }
            counter++;
          } catch (err) {
            reject(err);
          }
        };
      });

      const worker = new Worker(queueName, processor, {
        autorun: false,
        connection,
        prefix,
      });
      await worker.waitUntilReady();

      for (let i = 1; i <= maxJobs; i++) {
        await queue.add('test', { foo: 'bar', num: i });
      }

      worker.run();

      await processing;
      await worker.close();
    });

    describe('when process function is not defined', function () {
      it('throws error', async () => {
        const worker = new Worker(queueName, undefined, {
          autorun: false,
          connection,
          prefix,
        });
        await worker.waitUntilReady();

        await expect(worker.run()).to.be.rejectedWith(
          'No process function is defined.',
        );

        await worker.close();
      });
    });

    describe('when run method is called when worker is running', function () {
      it('throws error', async () => {
        const maxJobs = 10;
        const worker = new Worker(queueName, async () => {}, {
          autorun: false,
          connection,
          prefix,
        });
        await worker.waitUntilReady();
        worker.run();

        for (let i = 1; i <= maxJobs; i++) {
          await queue.add('test', { foo: 'bar', num: i });
        }

        await expect(worker.run()).to.be.rejectedWith(
          'Worker is already running.',
        );

        await worker.close();
      });
    });
  });

  it('process a job that updates progress as number', async () => {
    let processor;

    const job = await queue.add('test', { foo: 'bar' });
    expect(job.id).to.be.ok;
    expect(job.data.foo).to.be.eql('bar');

    const processing = new Promise<void>((resolve, reject) => {
      queueEvents.on('progress', ({ jobId, data }) => {
        expect(jobId).to.be.ok;
        expect(data).to.be.eql(42);
        resolve();
      });

      processor = async (job: Job) => {
        try {
          expect(job.data.foo).to.be.equal('bar');
          await job.updateProgress(42);
        } catch (err) {
          reject(err);
        }
      };
    });

    const worker = new Worker(queueName, processor, { connection, prefix });
    await worker.waitUntilReady();

    await processing;

    await worker.close();
  });

  it('process a job that updates progress as object', async () => {
    let processor;

    const job = await queue.add('test', { foo: 'bar' });
    expect(job.id).to.be.ok;
    expect(job.data.foo).to.be.eql('bar');

    const processing = new Promise<void>((resolve, reject) => {
      queueEvents.on('progress', ({ jobId, data }) => {
        expect(jobId).to.be.ok;
        expect(data).to.be.eql({ percentage: 42 });
        resolve();
      });

      processor = async (job: Job) => {
        try {
          expect(job.data.foo).to.be.equal('bar');
          await job.updateProgress({ percentage: 42 });
        } catch (err) {
          reject(err);
        }
      };
    });

    const worker = new Worker(queueName, processor, { connection, prefix });
    await worker.waitUntilReady();

    await processing;

    await worker.close();
  });

  it('processes jobs that were added before the worker started', async () => {
    const jobs = [
      queue.add('test', { bar: 'baz' }),
      queue.add('test', { bar1: 'baz1' }),
      queue.add('test', { bar2: 'baz2' }),
      queue.add('test', { bar3: 'baz3' }),
    ];

    await Promise.all(jobs);

    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
    });
    await worker.waitUntilReady();

    await new Promise(resolve => {
      const resolveAfterAllJobs = after(jobs.length, resolve);
      worker.on('completed', resolveAfterAllJobs);
    });

    await worker.close();
  });

  it('process a job that returns data in the process handler', async () => {
    const worker = new Worker(
      queueName,
      async job => {
        expect(job.data.foo).to.be.equal('bar');
        return 37;
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const job = await queue.add('test', { foo: 'bar' });
    expect(job.id).to.be.ok;
    expect(job.data.foo).to.be.eql('bar');

    await new Promise<void>((resolve, reject) => {
      worker.on('completed', async (job: Job, data: any) => {
        try {
          expect(job).to.be.ok;
          expect(data).to.be.eql(37);

          const gotJob = await queue.getJob(job.id);
          expect(gotJob.returnvalue).to.be.eql(37);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await worker.close();
  });

  it('process a job that returns a string in the process handler', async () => {
    const testString = 'a very dignified string';

    const worker = new Worker(
      queueName,
      async () => {
        return testString;
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const waiting = new Promise<void>((resolve, reject) => {
      queueEvents.on('completed', async data => {
        try {
          expect(data).to.be.ok;
          expect(data.returnvalue).to.be.equal(testString);
          await delay(100);
          const gotJob = await queue.getJob(data.jobId);

          expect(gotJob).to.be.ok;
          expect(gotJob.returnvalue).to.be.equal(testString);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await queue.add('test', { testing: true });
    await waiting;
    await worker.close();
  });

  it('process a job that returning data returnvalue gets stored in the database', async () => {
    const worker = new Worker(
      queueName,
      async job => {
        expect(job.data.foo).to.be.equal('bar');
        return 37;
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const job = await queue.add('test', { foo: 'bar' });
    expect(job.id).to.be.ok;
    expect(job.data.foo).to.be.eql('bar');

    await new Promise<void>((resolve, reject) => {
      worker.on('completed', async (job: Job, data: any) => {
        try {
          expect(job).to.be.ok;
          expect(data).to.be.eql(37);
          const gotJob = await queue.getJob(job.id);
          expect(gotJob.returnvalue).to.be.eql(37);

          const retval = await (
            await queue.client
          ).hget(queue.toKey(gotJob.id), 'returnvalue');
          expect(JSON.parse(retval)).to.be.eql(37);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await worker.close();
  });

  it('process a job that does some asynchronous operation', async () => {
    const worker = new Worker(
      queueName,
      async job => {
        expect(job.data.foo).to.be.equal('bar');
        await delay(250);
        return 'my data';
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const job = await queue.add('test', { foo: 'bar' });
    expect(job.id).to.be.ok;
    expect(job.data.foo).to.be.eql('bar');

    await new Promise<void>(resolve => {
      worker.on('completed', (job: Job, data: any) => {
        expect(job).to.be.ok;
        expect(data).to.be.eql('my data');
        resolve();
      });
    });

    await worker.close();
  });

  it('process a synchronous job', async () => {
    const worker = new Worker(
      queueName,
      async job => {
        expect(job.data.foo).to.be.equal('bar');
      },
      { connection, prefix },
    );

    await worker.waitUntilReady();

    const job = await queue.add('test', { foo: 'bar' });
    expect(job.id).to.be.ok;
    expect(job.data.foo).to.be.eql('bar');

    await new Promise<void>(resolve => {
      worker.on('completed', job => {
        expect(job).to.be.ok;
        resolve();
      });
    });

    await worker.close();
  });

  it('does not process a job that is being processed when a new queue starts', async () => {
    this.timeout(12000);
    let err;

    const worker = new Worker(
      queueName,
      async job => {
        expect(job.data.foo).to.be.equal('bar');

        if (addedJob.id !== job.id) {
          err = new Error('Processed job id does not match that of added job');
        }
        await delay(500);
      },
      { connection, prefix },
    );

    await worker.waitUntilReady();

    const addedJob = await queue.add('test', { foo: 'bar' });

    const anotherWorker = new Worker(
      queueName,
      async () => {
        err = new Error(
          'The second queue should not have received a job to process',
        );
      },
      { connection, prefix },
    );

    worker.on('completed', async () => {
      await anotherWorker.close();
    });

    await worker.close();
    await anotherWorker.close();

    if (err) {
      throw err;
    }
  });

  it('process a job that throws an exception', async () => {
    const jobError = new Error('Job Failed');

    const worker = new Worker(
      queueName,
      async job => {
        expect(job.data.foo).to.be.equal('bar');
        throw jobError;
      },
      { autorun: false, connection, prefix },
    );
    await worker.waitUntilReady();

    const job = await queue.add('test', { foo: 'bar' });
    expect(job.id).to.be.ok;
    expect(job.data.foo).to.be.eql('bar');

    const failing = new Promise<void>(resolve => {
      worker.once('failed', async (job, err) => {
        expect(job).to.be.ok;
        expect(job.finishedOn).to.be.a('number');
        expect(job.data.foo).to.be.eql('bar');
        expect(err).to.be.eql(jobError);
        resolve();
      });
    });

    worker.run();

    await failing;

    await worker.close();
  });

  it('process a job that returns data with a circular dependency', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        const circular = { x: {} };
        circular.x = circular;
        return circular;
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const waiting = new Promise<void>((resolve, reject) => {
      worker.on('failed', () => {
        resolve();
      });
      worker.on('completed', () => {
        reject(Error('Should not complete'));
      });
    });

    await queue.add('test', { foo: 'bar' });

    await waiting;
    await worker.close();
  });

  it('process a job that returns a rejected promise', async () => {
    const jobError = new Error('Job Failed');

    const worker = new Worker(
      queueName,
      async job => {
        expect(job.data.foo).to.be.equal('bar');
        return Promise.reject(jobError);
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const job = await queue.add('test', { foo: 'bar' });
    expect(job.id).to.be.ok;
    expect(job.data.foo).to.be.eql('bar');

    await new Promise<void>((resolve, reject) => {
      worker.once('failed', (job, err) => {
        try {
          expect(job.id).to.be.ok;
          expect(job.data.foo).to.be.eql('bar');
          expect(err).to.be.eql(jobError);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await worker.close();
  });

  it('retry a job that fails', async () => {
    let failedOnce = false;
    const notEvenErr = new Error('Not even!');

    const worker = new Worker(
      queueName,
      async () => {
        if (!failedOnce) {
          throw notEvenErr;
        }
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const failing = new Promise<void>((resolve, reject) => {
      worker.once('failed', async (job, err) => {
        try {
          expect(job).to.be.ok;
          expect(job.data.foo).to.be.eql('bar');
          expect(err).to.be.eql(notEvenErr);
          failedOnce = true;
        } catch (err) {
          reject(err);
        }
        resolve();
      });
    });

    const completing = new Promise<void>((resolve, reject) => {
      worker.once('completed', () => {
        try {
          expect(failedOnce).to.be.eql(true);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    const job = await queue.add('test', { foo: 'bar' });
    expect(job.id).to.be.ok;
    expect(job.data.foo).to.be.eql('bar');

    await failing;
    await job.retry();
    await completing;

    await worker.close();
  });

  it('retry a job that completes', async () => {
    let completedOnce = false;

    const worker = new Worker(
      queueName,
      async () => {
        if (!completedOnce) {
          return 1;
        }
        return 2;
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    let count = 1;
    const completing = new Promise<void>((resolve, reject) => {
      worker.once('completed', async (job, result) => {
        try {
          expect(job).to.be.ok;
          expect(job.data.foo).to.be.eql('bar');
          expect(result).to.be.eql(count++);
          completedOnce = true;
        } catch (err) {
          reject(err);
        }
        resolve();
      });
    });

    const job = await queue.add('test', { foo: 'bar' });
    expect(job.id).to.be.ok;
    expect(job.data.foo).to.be.eql('bar');

    await completing;
    await job.retry('completed');
    await completing;

    await worker.close();
  });

  describe('when queue is paused and retry a job', () => {
    it('moves job to paused', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const completing = new Promise<void>((resolve, reject) => {
        worker.once('completed', async job => {
          try {
            expect(job).to.be.ok;
            expect(job.data.foo).to.be.eql('bar');
          } catch (err) {
            reject(err);
          }
          resolve();
        });
      });

      const job = await queue.add('test', { foo: 'bar' });
      expect(job.id).to.be.ok;
      expect(job.data.foo).to.be.eql('bar');

      await completing;
      await queue.pause();
      await job.retry('completed');

      const pausedJobsCount = await queue.getJobCountByTypes('paused');
      expect(pausedJobsCount).to.be.equal(1);

      await worker.close();
    });
  });

  it('retry a job that fails using job retry method', async () => {
    let called = 0;
    let failedOnce = false;
    const notEvenErr = new Error('Not even!');

    const worker = new Worker(
      queueName,
      async () => {
        called++;
        if (called % 2 !== 0) {
          throw notEvenErr;
        }
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();

    const job = await queue.add('test', { foo: 'bar' });
    expect(job.id).to.be.ok;
    expect(job.data.foo).to.be.eql('bar');

    worker.once('failed', async (job, err) => {
      expect(job).to.be.ok;
      expect(job.data.foo).to.be.eql('bar');
      expect(err).to.be.eql(notEvenErr);
      failedOnce = true;

      await worker.pause(true);

      await job.retry();

      expect(job.failedReason).to.be.null;
      expect(job.processedOn).to.be.null;
      expect(job.finishedOn).to.be.null;
      expect(job.returnvalue).to.be.null;

      const updatedJob = await queue.getJob(job.id);
      expect(updatedJob.failedReason).to.be.undefined;
      expect(updatedJob.processedOn).to.be.undefined;
      expect(updatedJob.finishedOn).to.be.undefined;
      expect(updatedJob.returnvalue).to.be.null;

      await worker.resume();
    });

    await new Promise<void>(resolve => {
      worker.once('completed', () => {
        expect(failedOnce).to.be.eql(true);
        resolve();
      });
    });

    await worker.close();
  });

  it('keeps locks for all the jobs that are processed concurrently', async function () {
    this.timeout(10000);

    const concurrency = 57;

    const lockKey = (jobId: string) => `${prefix}:${queueName}:${jobId}:lock`;
    const client = await queue.client;

    let worker;

    const processing = new Promise<void>((resolve, reject) => {
      let count = 0;
      worker = new Worker(
        queueName,
        async job => {
          try {
            // Check job is locked
            const lock = await client.get(lockKey(job.id!));
            expect(lock).to.be.ok;

            await delay(2000);

            // Check job is still locked
            const renewedLock = await client.get(lockKey(job.id!));
            expect(renewedLock).to.be.eql(lock);

            count++;

            if (count === concurrency) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        },
        {
          connection,
          prefix,
          lockDuration: 250,
          concurrency,
        },
      );
    });

    await worker.waitUntilReady();

    const jobs = await Promise.all(
      Array.from({ length: concurrency }).map(() =>
        queue.add('test', { bar: 'baz' }),
      ),
    );

    await processing;

    await worker.close();
  });

  it('emits error if lock is lost', async function () {
    this.timeout(10000);

    const worker = new Worker(
      queueName,
      async () => {
        return delay(2000);
      },
      {
        connection,
        prefix,
        lockDuration: 1000,
        lockRenewTime: 3000, // The lock will not be updated in time
      },
    );
    await worker.waitUntilReady();

    const job = await queue.add('test', { bar: 'baz' });

    const errorMessage = `Missing lock for job ${job.id}. failed`;
    const workerError = new Promise<void>((resolve, reject) => {
      worker.once('error', error => {
        try {
          expect(error.message).to.be.equal(errorMessage);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await workerError;

    await worker.close();
  });

  it('emits error if lock is "stolen"', async function () {
    this.timeout(10000);

    const connection = new IORedis({
      host: redisHost,
      maxRetriesPerRequest: null,
    });

    const worker = new Worker(
      queueName,
      async job => {
        connection.set(`${prefix}:${queueName}:${job.id}:lock`, 'foo');
        return delay(2000);
      },
      {
        connection,
        prefix,
      },
    );
    await worker.waitUntilReady();

    const job = await queue.add('test', { bar: 'baz' });

    const errorMessage = `Lock mismatch for job ${job.id}. Cmd failed from active`;
    const workerError = new Promise<void>((resolve, reject) => {
      worker.once('error', error => {
        try {
          expect(error.message).to.be.equal(errorMessage);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await workerError;

    await worker.close();
  });

  it('continues processing after a worker has stalled', async function () {
    let first = true;
    this.timeout(10000);

    const worker = new Worker(
      queueName,
      async () => {
        if (first) {
          first = false;
          return delay(2000);
        }
      },
      {
        connection,
        prefix,
        lockDuration: 1000,
        lockRenewTime: 3000, // The lock will not be updated
        stalledInterval: 100,
      },
    );
    await worker.waitUntilReady();

    await queue.add('test', { bar: 'baz' });

    const completed = new Promise(resolve => {
      worker.on('completed', resolve);
    });

    await completed;

    await worker.close();
  });

  it('stalled interval cannot be zero', function () {
    this.timeout(8000);
    expect(
      () =>
        new Worker(queueName, async () => {}, {
          connection,
          prefix,
          stalledInterval: 0,
        }),
    ).to.throw('stalledInterval must be greater than 0');
  });

  it('lock extender continues to run until all active jobs are completed when closing a worker', async function () {
    this.timeout(4000);
    let worker;

    const startProcessing = new Promise<void>(resolve => {
      worker = new Worker(
        queueName,
        async () => {
          resolve();
          return delay(2000);
        },
        {
          connection,
          lockDuration: 1000,
          lockRenewTime: 500,
          stalledInterval: 1000,
          prefix,
        },
      );
    });

    await queue.add('test', { bar: 'baz' });

    const completed = new Promise((resolve, reject) => {
      worker.on('completed', resolve);
      worker.on('failed', reject);
    });

    await startProcessing;
    await worker.close();

    await completed;
  });

  describe('Concurrency process', () => {
    it('should thrown an exception if I specify a concurrency of 0', () => {
      try {
        const worker = new Worker(queueName, async () => {}, {
          connection,
          prefix,
          concurrency: 0,
        });
        throw new Error('Should have thrown an exception');
      } catch (err) {
        expect(err.message).to.be.equal(
          'concurrency must be a finite number greater than 0',
        );
      }
    });

    it('should thrown an exception if I specify a NaN concurrency', () => {
      try {
        const worker = new Worker(queueName, async () => {}, {
          connection,
          prefix,
          concurrency: NaN,
        });
        throw new Error('Should have thrown an exception');
      } catch (err) {
        expect(err.message).to.be.equal(
          'concurrency must be a finite number greater than 0',
        );
      }
    });

    it('should run job in sequence if I specify a concurrency of 1', async () => {
      let processing = false;

      const worker = new Worker(
        queueName,
        async () => {
          expect(processing).to.be.equal(false);
          processing = true;
          await delay(50);
          processing = false;
        },
        {
          connection,
          prefix,
          concurrency: 1,
        },
      );
      await worker.waitUntilReady();

      await queue.add('test', {});
      await queue.add('test', {});

      await new Promise(resolve => {
        worker.on('completed', after(2, resolve));
      });

      await worker.close();
    });

    //This job use delay to check that at any time we have 4 process in parallel.
    //Due to time to get new jobs and call process, false negative can appear.
    it('should process job respecting the concurrency set', async function () {
      this.timeout(10000);
      let nbProcessing = 0;
      let pendingMessageToProcess = 8;
      let wait = 10;

      const worker = new Worker(
        queueName,
        async () => {
          try {
            nbProcessing++;
            expect(nbProcessing).to.be.lessThan(5);

            wait += 100;

            await delay(wait);
            //We should not have 4 more in parallel.
            //At the end, due to empty list, no new job will process, so nbProcessing will decrease.
            expect(nbProcessing).to.be.eql(
              Math.min(pendingMessageToProcess, 4),
            );
            pendingMessageToProcess--;
            nbProcessing--;
          } catch (err) {
            console.error(err);
          }
        },
        {
          connection,
          prefix,
          concurrency: 4,
        },
      );
      await worker.waitUntilReady();

      const waiting = new Promise((resolve, reject) => {
        worker.on('completed', after(8, resolve));
        worker.on('failed', reject);
      });

      await Promise.all(times(8, () => queue.add('test', {})));

      await waiting;
      await worker.close();
    });

    describe('when changing concurrency', () => {
      describe('when increasing value', () => {
        it('should process job respecting the current concurrency set', async function () {
          this.timeout(10000);
          let nbProcessing = 0;
          let pendingMessageToProcess = 16;
          let wait = 10;

          const worker = new Worker(
            queueName,
            async job => {
              try {
                nbProcessing++;
                if (job.data.index < 8) {
                  expect(nbProcessing).to.be.lessThan(5);
                } else {
                  expect(nbProcessing).to.be.lessThan(9);
                }

                wait += 100;

                await delay(wait);
                if (job.data.index < 8) {
                  expect(nbProcessing).to.be.eql(
                    Math.min(pendingMessageToProcess, 4),
                  );
                } else {
                  expect(nbProcessing).to.be.eql(
                    Math.min(pendingMessageToProcess, 8),
                  );
                }
                pendingMessageToProcess--;
                nbProcessing--;
              } catch (err) {
                console.error(err);
              }
            },
            {
              connection,
              prefix,
              concurrency: 4,
            },
          );
          await worker.waitUntilReady();

          const waiting1 = new Promise((resolve, reject) => {
            worker.on('completed', after(8, resolve));
            worker.on('failed', reject);
          });

          const jobs = Array.from(Array(16).keys()).map(index => ({
            name: 'test',
            data: { index },
          }));

          await queue.addBulk(jobs);

          await waiting1;

          worker.concurrency = 8;

          const waiting2 = new Promise((resolve, reject) => {
            worker.on('completed', after(8, resolve));
            worker.on('failed', reject);
          });

          await waiting2;

          await worker.close();
        });
      });

      describe('when decreasing value', () => {
        it('should process job respecting the current concurrency set', async function () {
          this.timeout(10000);
          let nbProcessing = 0;
          let pendingMessageToProcess = 20;
          let wait = 100;

          const worker = new Worker(
            queueName,
            async () => {
              nbProcessing++;
              if (pendingMessageToProcess > 7) {
                expect(nbProcessing).to.be.lessThan(5);
              } else {
                expect(nbProcessing).to.be.lessThan(3);
              }
              wait += 50;

              await delay(wait);
              if (pendingMessageToProcess > 11) {
                expect(nbProcessing).to.be.eql(
                  Math.min(pendingMessageToProcess, 4),
                );
              } else if (pendingMessageToProcess == 11) {
                expect(nbProcessing).to.be.eql(3);
              } else {
                expect(nbProcessing).to.be.eql(
                  Math.min(pendingMessageToProcess, 2),
                );
              }
              pendingMessageToProcess--;
              nbProcessing--;
            },
            {
              connection,
              prefix,
              concurrency: 4,
            },
          );
          await worker.waitUntilReady();

          let processed = 0;
          const waiting1 = new Promise<void>((resolve, reject) => {
            worker.on('completed', async () => {
              processed++;
              if (processed === 8) {
                worker.concurrency = 2;
              }

              if (processed === 20) {
                resolve();
              }
            });
            worker.on('failed', reject);
          });

          const jobs = Array.from(Array(20).keys()).map(index => ({
            name: 'test',
            data: { index },
          }));

          await queue.addBulk(jobs);

          await waiting1;

          await worker.close();
        });
      });
    });

    it('should wait for all concurrent processing in case of pause', async function () {
      this.timeout(10000);

      let i = 0;
      let nbJobFinish = 0;

      const worker = new Worker(
        queueName,
        async () => {
          try {
            if (++i === 4) {
              // Pause when all 4 works are processing
              await worker.pause();

              // Wait for all the active jobs to finalize.
              expect(nbJobFinish).to.be.equal(3);
              await worker.resume();
            }
          } catch (err) {
            console.error(err);
          }

          // 100 - i*20 is to force to finish job n°4 before lower jobs that will wait longer
          await delay(100 - i * 10);
          nbJobFinish++;

          // We simulate an error of one processing job.
          if (i % 7 === 0) {
            throw new Error();
          }
        },
        {
          connection,
          prefix,
          concurrency: 4,
        },
      );
      await worker.waitUntilReady();

      const waiting = new Promise((resolve, reject) => {
        const cb = after(8, resolve);
        worker.on('completed', cb);
        worker.on('failed', cb);
        worker.on('error', reject);
      });
      await Promise.all(times(8, () => queue.add('test', {})));

      await waiting;

      await worker.close();
    });
  });

  describe('Retries and backoffs', () => {
    it("updates job's delay property if it fails and backoff is set", async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('error');
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      await queue.add('test', { bar: 'baz' }, { attempts: 3, backoff: 300 });

      const failed = new Promise<void>((resolve, reject) => {
        worker.once('failed', async job => {
          try {
            expect(job?.delay).to.be.eql(300);
            const gotJob = await queue.getJob(job.id!);
            expect(gotJob!.delay).to.be.eql(300);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await failed;

      await worker.close();
    });

    it('deletes token after moving jobs to delayed', async function () {
      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsMade !== 3) {
            throw new Error('error');
          }
          return delay(100);
        },
        {
          connection,
          prefix,
          lockDuration: 10000,
          lockRenewTime: 3000, // The lock will not be updated
        },
      );
      await worker.waitUntilReady();

      const client = await queue.client;

      const job = await queue.add(
        'test',
        { bar: 'baz' },
        { attempts: 3, backoff: 100 },
      );

      worker.on('failed', async () => {
        const token = await client.get(`${prefix}:${queueName}:${job.id}:lock`);
        expect(token).to.be.null;
      });

      const workerCompleted = new Promise<void>(resolve => {
        worker.once('completed', () => {
          resolve();
        });
      });

      await workerCompleted;

      const token = await client.get(`${prefix}:${queueName}:${job.id}:lock`);

      expect(token).to.be.null;

      await worker.close();
    });

    describe('when backoff type is exponential', () => {
      it("updates job's delay property if it fails and backoff is set", async () => {
        const worker = new Worker(
          queueName,
          async () => {
            await delay(100);
            throw new Error('error');
          },
          { connection, prefix },
        );
        await worker.waitUntilReady();

        await queue.add(
          'test',
          { bar: 'baz' },
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 200,
            },
          },
        );

        const failed = new Promise<void>((resolve, reject) => {
          worker.on('failed', async job => {
            try {
              const attemptsMade = job?.attemptsMade;
              if (attemptsMade! > 2) {
                expect(job!.delay).to.be.eql(0);
                const gotJob = await queue.getJob(job.id!);
                expect(gotJob!.delay).to.be.eql(0);
                resolve();
              }
            } catch (err) {
              reject(err);
            }
          });
        });

        await failed;

        await worker.close();
      });
    });

    describe('when attempts is 1 and job fails', () => {
      it('should execute job only once and emits retries-exhausted event', async () => {
        const worker = new Worker(
          queueName,
          async () => {
            throw new Error('failed');
          },
          { connection, prefix },
        );

        await worker.waitUntilReady();

        const job = await queue.add(
          'test',
          { foo: 'bar' },
          {
            attempts: 1,
          },
        );

        await new Promise<void>(resolve => {
          queueEvents.on(
            'retries-exhausted',
            async ({ jobId, attemptsMade }) => {
              expect(jobId).to.eql(job.id);
              expect(1).to.eql(Number(attemptsMade));
              resolve();
            },
          );
        });

        const state = await job.getState();

        expect(state).to.be.equal('failed');

        await worker.close();
      });
    });

    describe('when jobs do not fail and get the maximum attempts limit', () => {
      it('does not emit retries-exhausted event', async () => {
        const worker = new Worker(queueName, async () => {}, {
          connection,
          prefix,
        });

        await worker.waitUntilReady();

        const completing = new Promise<void>((resolve, reject) => {
          queueEvents.on('retries-exhausted', async () => {
            reject();
          });

          queueEvents.on(
            'completed',
            after(3, async function () {
              resolve();
            }),
          );
        });

        await Promise.all(
          times(3, () =>
            queue.add(
              'test',
              { foo: 'baz' },
              {
                attempts: 1,
              },
            ),
          ),
        );

        await completing;

        await worker.close();
      });
    });

    describe('when job has been marked as discarded', () => {
      it('does not retry a job', async () => {
        const worker = new Worker(
          queueName,
          async job => {
            expect(job.attemptsMade).to.equal(1);
            job.discard();
            throw new Error('unrecoverable error');
          },
          { connection, prefix },
        );

        await worker.waitUntilReady();

        const job = await queue.add(
          'test',
          { foo: 'bar' },
          {
            attempts: 5,
          },
        );

        await new Promise(resolve => {
          worker.on('failed', resolve);
        });

        const state = await job.getState();

        expect(state).to.be.equal('failed');

        await worker.close();
      });
    });

    it('should automatically retry a failed job if attempts is bigger than 1', async () => {
      let tries = 0;

      const worker = new Worker(
        queueName,
        async job => {
          tries++;
          expect(job.attemptsMade).to.be.eql(tries);
          if (job.attemptsMade < 2) {
            throw new Error('Not yet!');
          }
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
        },
      );

      await new Promise(resolve => {
        worker.on('completed', resolve);
      });

      await worker.close();
    });

    describe('when there are delayed jobs between retries', () => {
      describe('when using retryJob', () => {
        it('promotes delayed jobs first', async () => {
          let id = 0;

          const worker = new Worker(
            queueName,
            async job => {
              id++;
              await delay(200);
              if (job.attemptsMade === 1) {
                expect(job.id).to.be.eql(`${id}`);
              }
              if (job.id == '1' && job.attemptsMade < 2) {
                throw new Error('Not yet!');
              }
            },
            { connection, prefix },
          );

          await worker.waitUntilReady();

          const completing = new Promise(resolve => {
            worker.on('completed', after(4, resolve));
          });

          await queue.add(
            'test',
            { foo: 'bar' },
            {
              attempts: 2,
            },
          );

          const jobs = Array.from(Array(3).keys()).map(index => ({
            name: 'test',
            data: {},
            opts: {
              delay: 200,
            },
          }));

          await queue.addBulk(jobs);

          await completing;

          await worker.close();
        });
      });

      describe('when job has more priority than delayed jobs', () => {
        it('executes retried job first', async () => {
          let id = 0;

          const worker = new Worker(
            queueName,
            async job => {
              await delay(200);
              if (job.attemptsMade === 1) {
                id++;
                expect(job.id).to.be.eql(`${id}`);
              }
              if (job.id == '1' && job.attemptsMade < 2) {
                throw new Error('Not yet!');
              }
            },
            { connection, prefix },
          );

          await worker.waitUntilReady();

          const completing = new Promise(resolve => {
            worker.on('completed', after(4, resolve));
          });

          await queue.add(
            'test',
            { foo: 'bar' },
            {
              attempts: 2,
              priority: 1,
            },
          );

          const jobs = Array.from(Array(3).keys()).map(index => ({
            name: 'test',
            data: {},
            opts: {
              delay: 200,
              priority: 2,
            },
          }));

          await queue.addBulk(jobs);

          await completing;

          await worker.close();
        });
      });
    });

    it('should not retry a failed job more than the number of given attempts times', async () => {
      let tries = 0;

      const worker = new Worker(
        queueName,
        async job => {
          tries++;
          if (job.attemptsMade < 4) {
            throw new Error('Not yet!');
          }
          expect(job.attemptsMade).to.be.eql(tries);
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const job = await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
        },
      );

      await new Promise<void>((resolve, reject) => {
        worker.on('completed', () => {
          reject(new Error('Failed job was retried more than it should be!'));
        });
        queueEvents.on('retries-exhausted', async ({ jobId, attemptsMade }) => {
          expect(jobId).to.eql(job.id);
          expect(3).to.eql(Number(attemptsMade));
          resolve();
        });
      });

      const state = await job.getState();

      expect(state).to.be.equal('failed');

      await worker.close();
    });

    it('should retry a job after a delay if a fixed backoff is given', async function () {
      this.timeout(10000);

      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsMade < 3) {
            throw new Error('Not yet!');
          }
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const start = Date.now();
      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: 1000,
        },
      );

      await new Promise<void>(resolve => {
        worker.on('completed', () => {
          const elapse = Date.now() - start;
          expect(elapse).to.be.greaterThan(2000);
          resolve();
        });
      });

      await worker.close();
    });

    describe('when UnrecoverableError is throw', () => {
      it('moves job to failed', async function () {
        this.timeout(8000);

        const worker = new Worker(
          queueName,
          async job => {
            if (job.attemptsMade < 2) {
              throw new Error('Not yet!');
            }
            if (job.attemptsMade < 3) {
              throw new UnrecoverableError('Unrecoverable');
            }
          },
          { connection, prefix },
        );

        await worker.waitUntilReady();

        const start = Date.now();
        const job = await queue.add(
          'test',
          { foo: 'bar' },
          {
            attempts: 3,
            backoff: 1000,
          },
        );

        await new Promise<void>(resolve => {
          worker.on(
            'failed',
            after(2, (job: Job, error) => {
              const elapse = Date.now() - start;
              expect(error.name).to.be.eql('UnrecoverableError');
              expect(error.message).to.be.eql('Unrecoverable');
              expect(elapse).to.be.greaterThan(1000);
              expect(job.attemptsMade).to.be.eql(2);
              resolve();
            }),
          );
        });

        const state = await job.getState();

        expect(state).to.be.equal('failed');

        await worker.close();
      });
    });

    describe('when providing a way to execute step jobs', () => {
      it('should retry a job after a delay if a fixed backoff is given, keeping the current step', async function () {
        this.timeout(8000);

        enum Step {
          Initial,
          Second,
          Finish,
        }

        const worker = new Worker(
          queueName,
          async job => {
            let step = job.data.step;
            while (step !== Step.Finish) {
              switch (step) {
                case Step.Initial: {
                  await job.updateData({
                    step: Step.Second,
                  });
                  step = Step.Second;
                  break;
                }
                case Step.Second: {
                  if (job.attemptsMade < 3) {
                    throw new Error('Not yet!');
                  }
                  await job.updateData({
                    step: Step.Finish,
                  });
                  step = Step.Finish;
                  return Step.Finish;
                }
                default: {
                  throw new Error('invalid step');
                }
              }
            }
          },
          { connection, prefix },
        );

        await worker.waitUntilReady();

        const start = Date.now();
        await queue.add(
          'test',
          { step: Step.Initial },
          {
            attempts: 3,
            backoff: 1000,
          },
        );

        await new Promise<void>(resolve => {
          worker.on('completed', job => {
            const elapse = Date.now() - start;
            expect(elapse).to.be.greaterThan(2000);
            expect(job.returnvalue).to.be.eql(Step.Finish);
            expect(job.attemptsMade).to.be.eql(3);
            resolve();
          });
        });

        await worker.close();
      });

      describe('when timeout is provided', () => {
        it('should check if timeout is reached in each step', async function () {
          enum Step {
            Initial,
            Second,
            Finish,
          }

          const worker = new Worker(
            queueName,
            async job => {
              let { step, timeout } = job.data;
              let timeoutReached = false;

              setTimeout(() => {
                timeoutReached = true;
              }, timeout);
              while (step !== Step.Finish) {
                switch (step) {
                  case Step.Initial: {
                    await delay(1000);
                    if (timeoutReached) {
                      throw new Error('Timeout');
                    }
                    await job.updateData({
                      step: Step.Second,
                      timeout,
                    });
                    step = Step.Second;
                    break;
                  }
                  case Step.Second: {
                    await delay(1000);
                    if (timeoutReached) {
                      throw new Error('Timeout');
                    }
                    await job.updateData({
                      step: Step.Finish,
                      timeout,
                    });
                    step = Step.Finish;
                    return Step.Finish;
                  }
                  default: {
                    throw new Error('invalid step');
                  }
                }
              }
            },
            { connection, prefix },
          );

          await worker.waitUntilReady();

          const start = Date.now();
          await queue.add(
            'test',
            { step: Step.Initial, timeout: 1500 },
            {
              attempts: 3,
              backoff: 500,
            },
          );

          await new Promise<void>(resolve => {
            worker.on('completed', job => {
              const elapse = Date.now() - start;
              expect(elapse).to.be.greaterThan(3000);
              expect(elapse).to.be.lessThan(4000);
              expect(job.failedReason).to.be.eql('Timeout');
              expect(job.returnvalue).to.be.eql(Step.Finish);
              expect(job.attemptsMade).to.be.eql(2);
              resolve();
            });
          });

          await worker.close();
        });
      });

      describe('when moving job to delayed in one step', () => {
        it('should retry job after a delay time, keeping the current step', async function () {
          this.timeout(8000);

          enum Step {
            Initial,
            Second,
            Finish,
          }

          const worker = new Worker(
            queueName,
            async (job, token) => {
              let step = job.data.step;
              while (step !== Step.Finish) {
                switch (step) {
                  case Step.Initial: {
                    await job.moveToDelayed(Date.now() + 200, token);
                    await job.updateData({
                      step: Step.Second,
                    });
                    throw new DelayedError();
                  }
                  case Step.Second: {
                    await job.updateData({
                      step: Step.Finish,
                    });
                    step = Step.Finish;
                    return Step.Finish;
                  }
                  default: {
                    throw new Error('invalid step');
                  }
                }
              }
            },
            { connection, prefix },
          );

          await worker.waitUntilReady();

          const start = Date.now();
          await queue.add('test', { step: Step.Initial });

          await new Promise<void>((resolve, reject) => {
            worker.on('completed', job => {
              const elapse = Date.now() - start;
              expect(elapse).to.be.greaterThan(200);
              expect(job.returnvalue).to.be.eql(Step.Finish);
              expect(job.attemptsMade).to.be.eql(2);
              resolve();
            });

            worker.on('error', () => {
              reject();
            });
          });

          await worker.close();
        });
      });

      describe('when creating children at runtime', () => {
        it('should wait children as one step of the parent job', async function () {
          this.timeout(8000);
          const parentQueueName = `parent-queue-${v4()}`;
          const parentQueue = new Queue(parentQueueName, {
            connection,
            prefix,
          });

          enum Step {
            Initial,
            Second,
            Third,
            Finish,
          }

          let waitingChildrenStepExecutions = 0;

          const worker = new Worker(
            parentQueueName,
            async (job, token) => {
              let step = job.data.step;
              while (step !== Step.Finish) {
                switch (step) {
                  case Step.Initial: {
                    await queue.add(
                      'child-1',
                      { foo: 'bar' },
                      {
                        parent: {
                          id: job.id,
                          queue: job.queueQualifiedName,
                        },
                      },
                    );
                    await job.updateData({
                      step: Step.Second,
                    });
                    step = Step.Second;
                    break;
                  }
                  case Step.Second: {
                    await queue.add(
                      'child-2',
                      { foo: 'bar' },
                      {
                        parent: {
                          id: job.id,
                          queue: `${prefix}:${parentQueueName}`,
                        },
                      },
                    );
                    await job.updateData({
                      step: Step.Third,
                    });
                    step = Step.Third;
                    break;
                  }
                  case Step.Third: {
                    waitingChildrenStepExecutions++;
                    const shouldWait = await job.moveToWaitingChildren(token);
                    if (!shouldWait) {
                      await job.updateData({
                        step: Step.Finish,
                      });
                      step = Step.Finish;
                      return Step.Finish;
                    } else {
                      throw new WaitingChildrenError();
                    }
                  }
                  default: {
                    throw new Error('invalid step');
                  }
                }
              }
            },
            { connection, prefix },
          );
          const childrenWorker = new Worker(
            queueName,
            async () => {
              await delay(200);
            },
            {
              connection,
              prefix,
            },
          );
          await childrenWorker.waitUntilReady();
          await worker.waitUntilReady();

          await parentQueue.add(
            'test',
            { step: Step.Initial },
            {
              attempts: 3,
              backoff: 1000,
            },
          );

          await new Promise<void>((resolve, reject) => {
            worker.on('completed', job => {
              expect(job.returnvalue).to.equal(Step.Finish);
              resolve();
            });

            worker.on('error', () => {
              reject();
            });
          });

          expect(waitingChildrenStepExecutions).to.be.equal(2);
          await worker.close();
          await childrenWorker.close();
          await parentQueue.close();
        });
      });
    });

    it('should retry a job after a delay if an exponential backoff is given', async function () {
      this.timeout(10000);

      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsMade < 3) {
            throw new Error('Not yet!');
          }
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const start = Date.now();
      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
      );

      await new Promise<void>(resolve => {
        worker.on('completed', () => {
          const elapse = Date.now() - start;
          const expected = 1000 * (Math.pow(2, 2) - 1);
          expect(elapse).to.be.greaterThan(expected);
          resolve();
        });
      });

      await worker.close();
    });

    it('should retry a job after a delay if a custom backoff is given', async function () {
      this.timeout(10000);

      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsMade < 3) {
            throw new Error('Not yet!');
          }
        },
        {
          connection,
          prefix,
          settings: {
            backoffStrategy: (attemptsMade: number) => {
              return attemptsMade * 1000;
            },
          },
        },
      );

      await worker.waitUntilReady();

      const start = Date.now();
      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'custom',
          },
        },
      );

      await new Promise<void>(resolve => {
        worker.on('completed', () => {
          const elapse = Date.now() - start;
          expect(elapse).to.be.greaterThan(3000);
          resolve();
        });
      });

      await worker.close();
    });

    describe('when applying custom backoff by type', () => {
      it('should retry a job after a delay for custom type', async function () {
        this.timeout(10000);

        const worker = new Worker(
          queueName,
          async job => {
            if (job.attemptsMade < 3) {
              throw new Error('Not yet!');
            }
          },
          {
            connection,
            prefix,
            settings: {
              backoffStrategy: (
                attemptsMade: number,
                type: string,
                err: Error,
                job: MinimalJob,
              ) => {
                switch (type) {
                  case 'custom1': {
                    return attemptsMade * 1000;
                  }
                  case 'custom2': {
                    return attemptsMade * 2000;
                  }
                  default: {
                    throw new Error('invalid type');
                  }
                }
              },
            },
          },
        );

        await worker.waitUntilReady();

        const start = Date.now();
        await queue.add(
          'test',
          { foo: 'baz' },
          {
            attempts: 3,
            backoff: {
              type: 'custom1',
            },
          },
        );

        await new Promise<void>(resolve => {
          worker.on('completed', () => {
            const elapse = Date.now() - start;
            expect(elapse).to.be.greaterThan(3000);
            resolve();
          });
        });

        await queue.add(
          'test',
          { foo: 'bar' },
          {
            attempts: 3,
            backoff: {
              type: 'custom2',
            },
          },
        );

        await new Promise<void>(resolve => {
          worker.on('completed', () => {
            const elapse = Date.now() - start;
            expect(elapse).to.be.greaterThan(6000);
            resolve();
          });
        });

        await worker.close();
      });
    });

    it('should not retry a job if the custom backoff returns -1', async () => {
      let tries = 0;

      const worker = new Worker(
        queueName,
        async job => {
          tries++;
          if (job.attemptsMade < 3) {
            throw new Error('Not yet!');
          }
        },
        {
          connection,
          prefix,
          settings: {
            backoffStrategy: () => {
              return -1;
            },
          },
        },
      );

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'custom',
          },
        },
      );

      await new Promise<void>((resolve, reject) => {
        worker.on('completed', () => {
          reject(new Error('Failed job was retried more than it should be!'));
        });
        worker.on('failed', () => {
          if (tries === 1) {
            resolve();
          }
        });
      });

      await worker.close();
    });

    it('should retry a job after a delay if a custom backoff is given based on the error thrown', async function () {
      class CustomError extends Error {}

      this.timeout(12000);

      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsMade < 3) {
            throw new CustomError('Hey, custom error!');
          }
        },
        {
          connection,
          prefix,
          settings: {
            backoffStrategy: (
              attemptsMade: number,
              type: string,
              err: Error,
            ) => {
              if (err instanceof CustomError) {
                return 1500;
              }
              return 500;
            },
          },
        },
      );

      const start = Date.now();
      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'custom',
          },
        },
      );

      await new Promise<void>(resolve => {
        worker.on('completed', () => {
          const elapse = Date.now() - start;
          expect(elapse).to.be.greaterThan(3000);
          resolve();
        });
      });

      await worker.close();
    });

    it('should retry a job after a delay if a custom backoff is given based on the job data', async function () {
      class CustomError extends Error {
        failedIds: number[];
      }

      this.timeout(5000);

      const worker = new Worker(
        queueName,
        async job => {
          if (job.data.ids.length > 2) {
            const error = new CustomError('Hey, custom error!');
            error.failedIds = [1, 2];

            throw error;
          }
        },
        {
          connection,
          prefix,
          settings: {
            backoffStrategy: async (
              attemptsMade: number,
              type: string,
              err: Error,
              job: MinimalJob,
            ) => {
              if (err instanceof CustomError) {
                const data = job.data;
                data.ids = err.failedIds;
                await job.updateData(data);
                return 2500;
              }
              return 500;
            },
          },
        },
      );

      const start = Date.now();
      await queue.add(
        'test',
        { ids: [1, 2, 3] },
        {
          attempts: 3,
          backoff: {
            type: 'custom',
          },
        },
      );

      await new Promise<void>(resolve => {
        worker.on('completed', () => {
          const elapse = Date.now() - start;
          expect(elapse).to.be.greaterThan(2500);
          resolve();
        });
      });

      await worker.close();
    });

    it('should be able to handle a custom backoff if it returns a promise', async function () {
      this.timeout(10000);

      const worker = new Worker(
        queueName,
        async (job: Job) => {
          if (job.attemptsMade < 3) {
            throw new Error('some error');
          }
        },
        {
          connection,
          prefix,
          settings: {
            backoffStrategy: async () => {
              await delay(500);

              return 10;
            },
          },
        },
      );
      const start = Date.now();
      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 3,
          backoff: {
            type: 'custom',
          },
        },
      );

      await new Promise<void>(resolve => {
        worker.on('completed', () => {
          const elapse = Date.now() - start;
          expect(elapse).to.be.greaterThan(1000);
          resolve();
        });
      });

      await worker.close();
    });

    it('should not retry a job that has been removed', async () => {
      const failedError = new Error('failed');
      let attempts = 0;
      const worker = new Worker(
        queueName,
        async () => {
          if (attempts === 0) {
            attempts++;
            throw failedError;
          }
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const failing = new Promise<void>(resolve => {
        worker.on('failed', async (job, err) => {
          expect(job.data.foo).to.equal('bar');
          expect(err).to.equal(failedError);
          expect(job.failedReason).to.equal(failedError.message);
          await job.retry();
          resolve();
        });
      });

      const completing = new Promise<void>(resolve => {
        worker.on('completed', async () => {
          resolve();
        });
      });

      const retriedJob = await queue.add('test', { foo: 'bar' });

      await failing;
      await completing;

      const count = await queue.getCompletedCount();
      expect(count).to.equal(1);
      await delay(10);
      await queue.clean(0, 0);

      await expect(retriedJob.retry()).to.be.rejectedWith(
        `Missing key for job ${retriedJob.id}. reprocessJob`,
      );

      const completedCount = await queue.getCompletedCount();
      expect(completedCount).to.equal(0);
      const failedCount = await queue.getFailedCount();
      expect(failedCount).to.equal(0);

      await worker.close();
    });

    it('should not retry a job that has been retried already', async () => {
      let attempts = 0;
      const failedError = new Error('failed');

      const worker = new Worker(
        queueName,
        async () => {
          if (attempts === 0) {
            attempts++;
            throw failedError;
          }
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const failing = new Promise<void>(resolve => {
        worker.on('failed', async (job, err) => {
          expect(job.data.foo).to.equal('bar');
          expect(err).to.equal(failedError);
          await job.retry();
          resolve();
        });
      });

      const completing = new Promise<void>(resolve => {
        worker.on('completed', async () => {
          resolve();
        });
      });

      const retriedJob = await queue.add('test', { foo: 'bar' });

      await failing;
      await completing;

      const completedCount = await queue.getCompletedCount();
      expect(completedCount).to.equal(1);

      await expect(retriedJob.retry()).to.be.rejectedWith(
        `Job ${retriedJob.id} is not in the failed state. reprocessJob`,
      );

      const completedCount2 = await queue.getCompletedCount();
      expect(completedCount2).to.equal(1);
      const failedCount = await queue.getFailedCount();
      expect(failedCount).to.equal(0);

      await worker.close();
    });

    it('should only retry a job once after it has reached the max attempts', async () => {
      let attempts = 0;
      const failedError = new Error('failed');

      const worker = new Worker(
        queueName,
        async () => {
          if (attempts < 3) {
            attempts++;
            throw failedError;
          }
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const failing = new Promise<void>(resolve => {
        worker.on('failed', async (job, err) => {
          expect(job.data.foo).to.equal('bar');
          expect(err).to.equal(failedError);
          if (job.attemptsMade === 2) {
            await job.retry();
            resolve();
          }
        });
      });

      const failedAgain = new Promise<void>(resolve => {
        worker.on('failed', async job => {
          if (job.attemptsMade === 3) {
            resolve();
          }
        });
      });

      const retriedJob = await queue.add(
        'test',
        { foo: 'bar' },
        { attempts: 2 },
      );

      await failing;
      await failedAgain;

      const failedCount = await queue.getFailedCount();
      expect(failedCount).to.equal(1);

      await expect(retriedJob.retry('completed')).to.be.rejectedWith(
        `Job ${retriedJob.id} is not in the completed state. reprocessJob`,
      );

      const completedCount = await queue.getCompletedCount();
      expect(completedCount).to.equal(0);

      await worker.close();
    });

    it('should not retry a job that is active', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(500);
        },
        { connection, prefix },
      );

      await worker.waitUntilReady();

      const activating = new Promise(resolve => {
        worker.on('active', resolve);
      });

      const job = await queue.add('test', { foo: 'bar' });

      expect(job.data.foo).to.equal('bar');

      await activating;

      await expect(job.retry()).to.be.rejectedWith(
        `Job ${job.id} is not in the failed state. reprocessJob`,
      );

      await worker.close();
    });

    /*
    it('an unlocked job should not be moved to failed', done => {
      queue = utils.buildQueue('test unlocked failed');

      queue.process((job, callback) => {
        // Release the lock to simulate the event loop stalling (so failure to renew the lock).
        job.releaseLock().then(() => {
          // Once it's failed, it should NOT be moved to failed since this worker lost the lock.
          callback(new Error('retry this job'));
        });
      });

      queue.on('failed', job => {
        job.isFailed().then(isFailed => {
          expect(isFailed).to.be.equal(false);
        });
      });

      queue.on('error', (err) => {
        queue.close().then(done, done);
      });

      // Note that backoff:0 should immediately retry the job upon failure (ie put it in 'waiting')
      queue.add({ foo: 'bar' }, { backoff: 0, attempts: 2 });
    });
    */
  });

  describe('Manually process jobs', () => {
    it('should allow to complete jobs manually', async () => {
      const worker = new Worker(queueName, void 0, { connection, prefix });
      const token = 'my-token';

      await queue.add('test', { foo: 'bar' });

      const job = (await worker.getNextJob(token)) as Job;

      const isActive = await job.isActive();
      expect(isActive).to.be.equal(true);

      await job.moveToCompleted('return value', token);

      const isCompleted = await job.isCompleted();

      expect(isCompleted).to.be.equal(true);

      await worker.close();
    });

    describe('when move job to waiting-children', () => {
      it('allows to move parent job to waiting-children', async () => {
        const values = [
          { idx: 0, bar: 'something' },
          { idx: 1, baz: 'something' },
          { idx: 2, qux: 'something' },
        ];
        const client = await queue.client;
        const parentToken = 'parent-token';
        const parentToken2 = 'parent-token2';
        const childToken = 'child-token';

        const parentQueueName = `parent-queue-${v4()}`;

        const parentQueue = new Queue(parentQueueName, { connection, prefix });
        const parentWorker = new Worker(parentQueueName, null, {
          connection,
          prefix,
        });
        const childrenWorker = new Worker(queueName, null, {
          connection,
          prefix,
        });

        const data = { foo: 'bar' };
        await Job.create(parentQueue, 'testDepend', data);
        const parent = (await parentWorker.getNextJob(parentToken)) as Job;
        const currentState = await parent.getState();

        expect(currentState).to.be.equal('active');

        await Job.create(queue, 'testJob1', values[0], {
          parent: {
            id: parent.id,
            queue: `${prefix}:${parentQueueName}`,
          },
        });
        await Job.create(queue, 'testJob2', values[1], {
          parent: {
            id: parent.id,
            queue: `${prefix}:${parentQueueName}`,
          },
        });
        await Job.create(queue, 'testJob3', values[2], {
          parent: {
            id: parent.id,
            queue: `${prefix}:${parentQueueName}`,
          },
        });
        const { unprocessed: unprocessed1 } = await parent.getDependencies();

        expect(unprocessed1).to.have.length(3);

        const child1 = (await childrenWorker.getNextJob(childToken)) as Job;
        const child2 = (await childrenWorker.getNextJob(childToken)) as Job;
        const child3 = (await childrenWorker.getNextJob(childToken)) as Job;
        const isActive1 = await child1.isActive();

        expect(isActive1).to.be.true;

        await child1.moveToCompleted('return value1', childToken);
        const { processed: processed2, unprocessed: unprocessed2 } =
          await parent.getDependencies();
        const movedToWaitingChildren = await parent.moveToWaitingChildren(
          parentToken,
          {
            child: {
              id: child3.id,
              queue: `${prefix}:${queueName}`,
            },
          },
        );

        const token = await client.get(
          `${prefix}:${queueName}:${parent.id}:lock`,
        );
        expect(token).to.be.null;
        expect(processed2).to.deep.equal({
          [`${prefix}:${queueName}:${child1.id}`]: 'return value1',
        });
        expect(unprocessed2).to.have.length(2);
        expect(movedToWaitingChildren).to.be.true;

        const isActive2 = await child2.isActive();

        expect(isActive2).to.be.true;

        await child2.moveToCompleted('return value2', childToken);
        const { processed: processed3, unprocessed: unprocessed3 } =
          await parent.getDependencies();
        const isWaitingChildren1 = await parent.isWaitingChildren();
        const { processed: processedCount, unprocessed: unprocessedCount } =
          await parent.getDependenciesCount();

        expect(processed3).to.deep.equal({
          [`${prefix}:${queueName}:${child1.id}`]: 'return value1',
          [`${prefix}:${queueName}:${child2.id}`]: 'return value2',
        });
        expect(processedCount).to.be.equal(2);
        expect(unprocessed3).to.have.length(1);
        expect(unprocessedCount).to.be.equal(1);
        expect(isWaitingChildren1).to.be.true;

        const isActive3 = await child3.isActive();

        expect(isActive3).to.be.true;

        await child3.moveToCompleted('return value3', childToken);
        const { processed: processed4, unprocessed: unprocessed4 } =
          await parent.getDependencies();
        const isWaitingChildren2 = await parent.isWaitingChildren();

        expect(isWaitingChildren2).to.be.false;
        const updatedParent = (await parentWorker.getNextJob(
          parentToken2,
        )) as Job;
        const movedToWaitingChildren2 =
          await updatedParent.moveToWaitingChildren(parentToken2);

        expect(processed4).to.deep.equal({
          [`${prefix}:${queueName}:${child1.id}`]: 'return value1',
          [`${prefix}:${queueName}:${child2.id}`]: 'return value2',
          [`${prefix}:${queueName}:${child3.id}`]: 'return value3',
        });
        expect(unprocessed4).to.have.length(0);
        expect(movedToWaitingChildren2).to.be.false;

        await childrenWorker.close();
        await parentWorker.close();

        await parentQueue.close();
        await removeAllQueueData(new IORedis(redisHost), parentQueueName);
      });

      describe('when job is not in active state', () => {
        it('throws an error', async () => {
          const values = [{ idx: 0, bar: 'something' }];
          const parentToken = 'parent-token';
          const childToken = 'child-token';

          const parentQueueName = `parent-queue-${v4()}`;

          const parentQueue = new Queue(parentQueueName, {
            connection,
            prefix,
          });
          const parentWorker = new Worker(parentQueueName, null, {
            connection,
            prefix,
          });
          const childrenWorker = new Worker(queueName, null, {
            connection,
            prefix,
          });

          const data = { foo: 'bar' };
          await Job.create(parentQueue, 'testDepend', data);

          const parent = (await parentWorker.getNextJob(parentToken)) as Job;
          const currentState = await parent.getState();

          expect(currentState).to.be.equal('active');

          await Job.create(queue, 'testJob1', values[0], {
            parent: {
              id: parent.id,
              queue: `${prefix}:${parentQueueName}`,
            },
          });
          const { unprocessed: unprocessed1 } = await parent.getDependencies();

          expect(unprocessed1).to.have.length(1);

          const child1 = (await childrenWorker.getNextJob(childToken)) as Job;
          const isActive1 = await child1.isActive();

          expect(isActive1).to.be.true;

          await parent.moveToWaitingChildren(parentToken, {
            child: {
              id: child1.id,
              queue: `${prefix}:${queueName}`,
            },
          });
          const waitingChildren = await parentQueue.getWaitingChildren();
          const currentState2 = await parent.getState();

          expect(currentState2).to.be.equal('waiting-children');
          expect(waitingChildren.length).to.be.equal(1);

          await expect(
            parent.moveToWaitingChildren(parentToken, {
              child: {
                id: child1.id,
                queue: `${prefix}:${queueName}`,
              },
            }),
          ).to.be.rejectedWith(
            `Missing lock for job ${parent.id}. moveToWaitingChildren`,
          );

          await expect(
            parent.moveToWaitingChildren('0', {
              child: {
                id: child1.id,
                queue: `${prefix}:${queueName}`,
              },
            }),
          ).to.be.rejectedWith(
            `Job ${parent.id} is not in the active state. moveToWaitingChildren`,
          );

          await childrenWorker.close();
          await parentWorker.close();

          await parentQueue.close();
          await removeAllQueueData(new IORedis(redisHost), parentQueueName);
        });
      });
    });

    it('should get paginated unprocessed dependencies keys', async () => {
      const value = { bar: 'something' };
      const parentToken = 'parent-token';

      const parentQueueName = `parent-queue-${v4()}`;

      const parentQueue = new Queue(parentQueueName, { connection, prefix });
      const parentWorker = new Worker(parentQueueName, null, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(queueName, null, {
        connection,
        prefix,
      });

      const data = { foo: 'bar' };
      await Job.create(parentQueue, 'parent', data);
      const parent = (await parentWorker.getNextJob(parentToken)) as Job;
      const currentState = await parent.getState();

      expect(currentState).to.be.equal('active');

      await Promise.all(
        Array.from(Array(65).keys()).map((index: number) => {
          return Job.create(
            queue,
            `child${index}`,
            { idx: index, ...value },
            {
              parent: {
                id: parent.id!,
                queue: `${prefix}:${parentQueueName}`,
              },
            },
          );
        }),
      );

      const { nextUnprocessedCursor: nextCursor1, unprocessed: unprocessed1 } =
        await parent.getDependencies({
          unprocessed: {
            cursor: 0,
            count: 50,
          },
        });

      if (isRedisVersionLowerThan(childrenWorker.redisVersion, '7.2.0')) {
        expect(unprocessed1!.length).to.be.greaterThanOrEqual(50);
        expect(nextCursor1).to.not.be.equal(0);
      } else {
        expect(unprocessed1!.length).to.be.equal(65);
        expect(nextCursor1).to.be.equal(0);
      }

      const { nextUnprocessedCursor: nextCursor2, unprocessed: unprocessed2 } =
        await parent.getDependencies({
          unprocessed: {
            cursor: nextCursor1,
            count: 50,
          },
        });

      if (isRedisVersionLowerThan(childrenWorker.redisVersion, '7.2.0')) {
        expect(unprocessed2!.length).to.be.lessThanOrEqual(15);
        expect(nextCursor2).to.be.equal(0);
      } else {
        expect(unprocessed2!.length).to.be.equal(65);
        expect(nextCursor2).to.be.equal(0);
      }

      expect(nextCursor2).to.be.equal(0);

      await Promise.all(
        Array.from(Array(64).keys()).map((index: number) => {
          return Job.create(
            queue,
            `child${index}`,
            { idx: index, ...value },
            {
              parent: {
                id: parent.id!,
                queue: `${prefix}:${parentQueueName}`,
              },
            },
          );
        }),
      );

      const { nextUnprocessedCursor: nextCursor3, unprocessed: unprocessed3 } =
        await parent.getDependencies({
          unprocessed: {
            cursor: 0,
            count: 50,
          },
        });

      expect(unprocessed3!.length).to.be.greaterThanOrEqual(50);
      expect(nextCursor3).to.not.be.equal(0);

      await childrenWorker.close();
      await parentWorker.close();

      await parentQueue.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it('should allow to fail jobs manually', async () => {
      const worker = new Worker(queueName, null, { connection, prefix });
      const token = 'my-token';

      await queue.add('test', { foo: 'bar' });

      const job = (await worker.getNextJob(token)) as Job;

      const isActive = await job.isActive();
      expect(isActive).to.be.equal(true);

      await job.moveToFailed(new Error('job failed for some reason'), token);

      const isCompleted = await job.isCompleted();
      const isFailed = await job.isFailed();

      expect(isCompleted).to.be.equal(false);
      expect(isFailed).to.be.equal(true);

      await worker.close();
    });
  });

  describe('non-blocking', async () => {
    it('should block by default', async () => {
      const worker = new Worker(queueName, null, { connection, prefix });
      const token = 'my-token';

      // make sure worker is in drained state
      await worker.getNextJob(token);

      const [job] = await Promise.all([
        worker.getNextJob(token) as Promise<Job>,
        delay(100).then(() => queue.add('test', { foo: 'bar' })),
      ]);
      expect(job).not.to.be.equal(undefined);
      const isActive = await job.isActive();
      expect(isActive).to.be.equal(true);

      await worker.close();
    });

    it("shouldn't block when disabled", async () => {
      const worker = new Worker(queueName, null, { connection, prefix });
      const token = 'my-token';

      // make sure worker is in drained state
      await worker.getNextJob(token, { block: false });

      const [job1] = await Promise.all([
        worker.getNextJob(token, { block: false }) as Promise<Job>,
        delay(100).then(() => queue.add('test', { foo: 'bar' })),
      ]);
      expect(job1).to.be.equal(undefined);

      const job2 = (await worker.getNextJob(token, { block: false })) as Job;
      const isActive = await job2.isActive();
      expect(isActive).to.be.equal(true);

      await worker.close();
    });

    it("shouldn't block when disabled and paused", async () => {
      const worker = new Worker(queueName, null, { connection, prefix });
      const token = 'my-token';

      // make sure worker is in drained state
      await worker.getNextJob(token, { block: false });
      await queue.add('test', { foo: 'bar' });

      worker.pause();

      const job1 = (await worker.getNextJob(token, { block: false })) as Job;
      expect(job1).to.be.equal(undefined);

      worker.resume();

      const job2 = (await worker.getNextJob(token, { block: false })) as Job;
      const isActive = await job2.isActive();
      expect(isActive).to.be.equal(true);

      await worker.close();
    });
  });

  it('should clear job from stalled set when job completed', async () => {
    const client = await queue.client;
    const worker = new Worker(
      queueName,
      async () => {
        return delay(100);
      },
      { connection, prefix, stalledInterval: 10 },
    );
    await worker.waitUntilReady();

    await queue.add('test', { foo: 'bar' });

    const allStalled = new Promise<void>(resolve => {
      worker.once('completed', async () => {
        const stalled = await client.scard(`${prefix}:${queueName}:stalled`);
        expect(stalled).to.be.equal(0);
        resolve();
      });
    });

    await allStalled;

    await worker.close();
  });
});
