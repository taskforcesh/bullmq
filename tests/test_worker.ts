import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { after, times } from 'lodash';
import { describe, beforeEach, it } from 'mocha';
import * as sinon from 'sinon';
import { v4 } from 'uuid';
import {
  Queue,
  QueueEvents,
  QueueScheduler,
  Job,
  UnrecoverableError,
  Worker,
} from '../src/classes';
import { KeepJobs, JobsOptions } from '../src/interfaces';
import { delay, removeAllQueueData } from '../src/utils';

describe('workers', function () {
  const sandbox = sinon.createSandbox();

  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;
  const connection = { host: 'localhost' };

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection });
    queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();
  });

  afterEach(async function () {
    sandbox.restore();
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(), queueName);
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
        { connection },
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
        { connection },
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
          expect(job.finishedOn).to.be.string;
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
        host: 'localhost',
      });

      const queue1 = new Queue(queueName2, { connection });

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

      const worker = new Worker(queueName2, processor, { connection });
      await worker.waitUntilReady();

      for (let i = 1; i <= maxJobs; i++) {
        await queue1.add('test', { foo: 'bar', num: i });
      }

      await processing;
      expect(worker.isRunning()).to.be.equal(true);

      await worker.close();
      await queue1.close();
      await removeAllQueueData(new IORedis(), queueName2);
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
        { connection },
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

    it('should remove job after completed if removeOnComplete', async () => {
      const worker = new Worker(
        queueName,
        async (job, token) => {
          expect(token).to.be.string;
          expect(job.data.foo).to.be.equal('bar');
        },
        { connection },
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
        defaultJobOptions: {
          removeOnComplete: true,
        },
      });

      const worker = new Worker(
        queueName,
        async job => {
          expect(job.data.foo).to.be.equal('bar');
        },
        { connection },
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
        defaultJobOptions: {
          removeOnComplete: keepJobs,
        },
      });

      const worker = new Worker(
        queueName,
        async job => {
          await job.log('test log');
        },
        { connection },
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
      const worker = new Worker(queueName, async job => {
        expect(job.data.foo).to.be.equal('bar');
        throw Error('error');
      });
      await worker.waitUntilReady();

      const newQueue = new Queue(queueName, {
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

      const worker = new Worker(queueName, async job => {
        expect(job.data.foo).to.be.equal('bar');
        throw Error('error');
      });
      await worker.waitUntilReady();

      const newQueue = new Queue(queueName, {
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

    const worker = new Worker(queueName, processor);
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

  it('should processes jobs by priority', async () => {
    const normalPriority = [];
    const mediumPriority = [];
    const highPriority = [];

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

    const worker = new Worker(queueName, processor);
    await worker.waitUntilReady();

    // wait for all jobs to enter the queue and then start processing
    await Promise.all([normalPriority, mediumPriority, highPriority]);

    await processing;

    await worker.close();
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

    const worker = new Worker(queueName, processor);
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
      const connection = new IORedis();

      return new Promise((resolve, reject) => {
        connection.on('ready', async () => {
          const worker1 = new Worker('test-shared', null, { connection });
          const worker2 = new Worker('test-shared', null, { connection });

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
      const connection = new IORedis();
      const queueName2 = `test-shared-${v4()}`;

      const queue2 = new Queue(queueName2, {
        defaultJobOptions: { removeOnComplete: true },
        connection,
      });

      await new Promise<void>((resolve, reject) => {
        connection.on('ready', async () => {
          const worker1 = new Worker(queueName2, null, { connection });
          const worker2 = new Worker(queueName2, null, { connection });

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
      await removeAllQueueData(new IORedis(), queueName2);
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

      const worker = new Worker(queueName, processor, { autorun: false });
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
        const worker = new Worker(queueName, undefined, { autorun: false });
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

    const worker = new Worker(queueName, processor);
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

    const worker = new Worker(queueName, processor);
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

    const worker = new Worker(queueName, async () => {});
    await worker.waitUntilReady();

    await new Promise(resolve => {
      const resolveAfterAllJobs = after(jobs.length, resolve);
      worker.on('completed', resolveAfterAllJobs);
    });

    await worker.close();
  });

  it('process a job that returns data in the process handler', async () => {
    const worker = new Worker(queueName, async job => {
      expect(job.data.foo).to.be.equal('bar');
      return 37;
    });
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

    const worker = new Worker(queueName, async () => {
      return testString;
    });
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
    const worker = new Worker(queueName, async job => {
      expect(job.data.foo).to.be.equal('bar');
      return 37;
    });
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
    const worker = new Worker(queueName, async job => {
      expect(job.data.foo).to.be.equal('bar');
      await delay(250);
      return 'my data';
    });
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
    const worker = new Worker(queueName, async job => {
      expect(job.data.foo).to.be.equal('bar');
    });

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

    const worker = new Worker(queueName, async job => {
      expect(job.data.foo).to.be.equal('bar');

      if (addedJob.id !== job.id) {
        err = new Error('Processed job id does not match that of added job');
      }
      await delay(500);
    });

    await worker.waitUntilReady();

    const addedJob = await queue.add('test', { foo: 'bar' });

    const anotherWorker = new Worker(queueName, async () => {
      err = new Error(
        'The second queue should not have received a job to process',
      );
    });

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

    const worker = new Worker(queueName, async job => {
      expect(job.data.foo).to.be.equal('bar');
      throw jobError;
    });
    await worker.waitUntilReady();

    const job = await queue.add('test', { foo: 'bar' });
    expect(job.id).to.be.ok;
    expect(job.data.foo).to.be.eql('bar');

    await new Promise<void>(resolve => {
      worker.once('failed', async (job, err) => {
        expect(job).to.be.ok;
        expect(job.data.foo).to.be.eql('bar');
        expect(err).to.be.eql(jobError);
        resolve();
      });
    });

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
      { connection },
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
      { connection },
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
      { connection },
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
      { connection },
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
      { connection },
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

  it('emits error if lock is lost', async function () {
    this.timeout(10000);

    const worker = new Worker(
      queueName,
      async () => {
        return delay(2000);
      },
      {
        connection,
        lockDuration: 1000,
        lockRenewTime: 3000, // The lock will not be updated
      },
    );
    await worker.waitUntilReady();

    const queueScheduler = new QueueScheduler(queueName, {
      connection,
      stalledInterval: 100,
    });
    await queueScheduler.waitUntilReady();

    const job = await queue.add('test', { bar: 'baz' });

    const errorMessage = `Missing lock for job ${job.id}. failed`;
    const workerError = new Promise<void>(resolve => {
      worker.once('error', error => {
        expect(error.message).to.be.equal(errorMessage);
        resolve();
      });
    });

    await workerError;

    await worker.close();
    await queueScheduler.close();
  });

  describe('when retrying jobs', () => {
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
          lockDuration: 10000,
          lockRenewTime: 3000, // The lock will not be updated
        },
      );
      await worker.waitUntilReady();

      const queueScheduler = new QueueScheduler(queueName, {
        connection,
      });
      await queueScheduler.waitUntilReady();
      const client = await queue.client;

      const job = await queue.add(
        'test',
        { bar: 'baz' },
        { attempts: 3, backoff: 100 },
      );

      worker.on('failed', async () => {
        const token = await client.get(`bull:${queueName}:${job.id}:lock`);
        expect(token).to.be.null;
      });

      const workerCompleted = new Promise<void>(resolve => {
        worker.once('completed', () => {
          resolve();
        });
      });

      await workerCompleted;

      const token = await client.get(`bull:${queueName}:${job.id}:lock`);

      expect(token).to.be.null;

      await worker.close();
      await queueScheduler.close();
    });
  });

  it('continue processing after a worker has stalled', async function () {
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
        lockDuration: 1000,
        lockRenewTime: 3000, // The lock will not be updated
      },
    );
    await worker.waitUntilReady();

    const queueScheduler = new QueueScheduler(queueName, {
      connection,
      stalledInterval: 100,
    });
    await queueScheduler.waitUntilReady();

    await queue.add('test', { bar: 'baz' });

    const completed = new Promise(resolve => {
      worker.on('completed', resolve);
    });

    await completed;

    await worker.close();
    await queueScheduler.close();
  });

  it('stalled interval cannot be zero', function () {
    this.timeout(10000);
    expect(
      () =>
        new QueueScheduler(queueName, {
          connection,
          stalledInterval: 0,
        }),
    ).to.throw('Stalled interval cannot be zero or undefined');
  });

  describe('Concurrency process', () => {
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
    describe('when attempts is 1 and job fails', () => {
      it('should execute job only once and emits retries-exhausted event', async () => {
        const worker = new Worker(
          queueName,
          async () => {
            throw new Error('failed');
          },
          { connection },
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

        await worker.close();
      });
    });

    describe('when jobs do not fail and get the maximum attempts limit', () => {
      it('should not emit retries-exhausted event', async () => {
        const worker = new Worker(queueName, async () => {}, { connection });

        await worker.waitUntilReady();

        const completing = new Promise<void>((resolve, reject) => {
          queueEvents.on('retries-exhausted', async () => {
            reject();
          });

          queueEvents.on(
            'completed',
            after(3, async function ({ jobId, returnvalue }) {
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

    it('should not retry a job if it has been marked as unrecoverable', async () => {
      let tries = 0;

      const worker = new Worker(
        queueName,
        async job => {
          tries++;
          expect(tries).to.equal(1);
          job.discard();
          throw new Error('unrecoverable error');
        },
        { connection },
      );

      await worker.waitUntilReady();

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 5,
        },
      );

      await new Promise(resolve => {
        worker.on('failed', resolve);
      });

      await worker.close();
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
        { connection },
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
        { connection },
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

      await worker.close();
    });

    it('should retry a job after a delay if a fixed backoff is given', async function () {
      this.timeout(10000);

      const queueScheduler = new QueueScheduler(queueName, { connection });
      await queueScheduler.waitUntilReady();

      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsMade < 3) {
            throw new Error('Not yet!');
          }
        },
        { connection },
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
      await queueScheduler.close();
    });

    describe('when UnrecoverableError is throw', () => {
      it('moves job to failed', async function () {
        this.timeout(8000);

        const queueScheduler = new QueueScheduler(queueName, { connection });
        await queueScheduler.waitUntilReady();

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
          { connection },
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

        await worker.close();
        await queueScheduler.close();
      });
    });

    describe('when providing a way to execute step jobs', () => {
      it('should retry a job after a delay if a fixed backoff is given, keeping the current step', async function () {
        this.timeout(8000);

        const queueScheduler = new QueueScheduler(queueName, { connection });
        await queueScheduler.waitUntilReady();

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
                  await job.update({
                    step: Step.Second,
                  });
                  step = Step.Second;
                  break;
                }
                case Step.Second: {
                  if (job.attemptsMade < 3) {
                    throw new Error('Not yet!');
                  }
                  await job.update({
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
          { connection },
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
        await queueScheduler.close();
      });

      describe('when creating children at runtime', () => {
        it('should wait children as one step of the parent job', async function () {
          this.timeout(8000);
          const parentQueueName = `parent-queue-${v4()}`;
          const parentQueue = new Queue(parentQueueName, { connection });

          const queueScheduler = new QueueScheduler(parentQueueName, {
            connection,
          });
          await queueScheduler.waitUntilReady();

          enum Step {
            Initial,
            Second,
            Third,
            Finish,
          }

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
                          queue: `${job.prefix}:${job.queueName}`,
                        },
                      },
                    );
                    await job.update({
                      step: Step.Second,
                    });
                    step = Step.Second;
                    break;
                  }
                  case Step.Second: {
                    if (job.attemptsMade < 3) {
                      throw new Error('Not yet!');
                    }
                    await queue.add(
                      'child-2',
                      { foo: 'bar' },
                      {
                        parent: {
                          id: job.id,
                          queue: `bull:${parentQueueName}`,
                        },
                      },
                    );
                    await job.update({
                      step: Step.Third,
                    });
                    step = Step.Third;
                    break;
                  }
                  case Step.Third: {
                    const shouldWait = await job.moveToWaitingChildren(token);
                    if (!shouldWait) {
                      await job.update({
                        step: Step.Finish,
                      });
                      step = Step.Finish;
                      return Step.Finish;
                    }
                    break;
                  }
                  default: {
                    throw new Error('invalid step');
                  }
                }
              }
            },
            { connection },
          );
          const childrenWorker = new Worker(
            queueName,
            async () => {
              await delay(100);
            },
            {
              connection,
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

          await new Promise<void>(resolve => {
            worker.on('completed', job => {
              expect(job.returnvalue).to.equal(Step.Finish);
              resolve();
            });
          });

          await worker.close();
          await childrenWorker.close();
          await parentQueue.close();
          await queueScheduler.close();
        });
      });
    });

    it('should retry a job after a delay if an exponential backoff is given', async function () {
      this.timeout(10000);

      const queueScheduler = new QueueScheduler(queueName, { connection });
      await queueScheduler.waitUntilReady();

      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsMade < 3) {
            throw new Error('Not yet!');
          }
        },
        { connection },
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
      await queueScheduler.close();
    });

    it('should retry a job after a delay if a custom backoff is given', async function () {
      this.timeout(10000);
      const queueScheduler = new QueueScheduler(queueName, { connection });
      await queueScheduler.waitUntilReady();

      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsMade < 3) {
            throw new Error('Not yet!');
          }
        },
        {
          connection,
          settings: {
            backoffStrategies: {
              custom(attemptsMade: number) {
                return attemptsMade * 1000;
              },
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
      await queueScheduler.close();
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
          settings: {
            backoffStrategies: {
              custom() {
                return -1;
              },
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
      const queueScheduler = new QueueScheduler(queueName);
      await queueScheduler.waitUntilReady();

      const worker = new Worker(
        queueName,
        async job => {
          if (job.attemptsMade < 3) {
            throw new CustomError('Hey, custom error!');
          }
        },
        {
          connection,
          settings: {
            backoffStrategies: {
              custom(attemptsMade: number, err: Error) {
                if (err instanceof CustomError) {
                  return 1500;
                }
                return 500;
              },
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
      await queueScheduler.close();
    });

    it('should retry a job after a delay if a custom backoff is given based on the job data', async function () {
      class CustomError extends Error {
        failedIds: number[];
      }

      this.timeout(5000);
      const queueScheduler = new QueueScheduler(queueName, { connection });
      await queueScheduler.waitUntilReady();

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
          settings: {
            backoffStrategies: {
              async custom(attemptsMade: number, err: Error, job: Job) {
                if (err instanceof CustomError) {
                  const data = job.data;
                  data.ids = err.failedIds;
                  await job.update(data);
                  return 2500;
                }
                return 500;
              },
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
      await queueScheduler.close();
    });

    it('should be able to handle a custom backoff if it returns a promise', async function () {
      this.timeout(10000);

      const queueScheduler = new QueueScheduler(queueName, { connection });
      await queueScheduler.waitUntilReady();

      const worker = new Worker(
        queueName,
        async (job: Job) => {
          if (job.attemptsMade < 3) {
            throw new Error('some error');
          }
        },
        {
          connection,
          settings: {
            backoffStrategies: {
              async custom() {
                return delay(500);
              },
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
      await queueScheduler.close();
    });

    it('should not retry a job that has been removed', async () => {
      const queueScheduler = new QueueScheduler(queueName, { connection });
      await queueScheduler.waitUntilReady();

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
        { connection },
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
      await queueScheduler.close();
    });

    it('should not retry a job that has been retried already', async () => {
      let attempts = 0;
      const failedError = new Error('failed');
      const queueScheduler = new QueueScheduler(queueName, { connection });
      await queueScheduler.waitUntilReady();

      const worker = new Worker(
        queueName,
        async () => {
          if (attempts === 0) {
            attempts++;
            throw failedError;
          }
        },
        { connection },
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
      await queueScheduler.close();
    });

    it('should only retry a job once after it has reached the max attempts', async () => {
      let attempts = 0;
      const failedError = new Error('failed');
      const queueScheduler = new QueueScheduler(queueName, { connection });
      await queueScheduler.waitUntilReady();

      const worker = new Worker(
        queueName,
        async () => {
          if (attempts < 3) {
            attempts++;
            throw failedError;
          }
        },
        { connection },
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
      await queueScheduler.close();
    });

    it('should not retry a job that is active', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(500);
        },
        { connection },
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
      const worker = new Worker(queueName, null, { connection });
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
        const parentToken = 'parent-token';
        const childToken = 'child-token';

        const parentQueueName = `parent-queue-${v4()}`;

        const parentQueue = new Queue(parentQueueName, { connection });
        const parentWorker = new Worker(parentQueueName, null, { connection });
        const childrenWorker = new Worker(queueName, null, { connection });

        const data = { foo: 'bar' };
        await Job.create(parentQueue, 'testDepend', data);
        const parent = (await parentWorker.getNextJob(parentToken)) as Job;
        const currentState = await parent.getState();

        expect(currentState).to.be.equal('active');

        await Job.create(queue, 'testJob1', values[0], {
          parent: {
            id: parent.id,
            queue: 'bull:' + parentQueueName,
          },
        });
        await Job.create(queue, 'testJob2', values[1], {
          parent: {
            id: parent.id,
            queue: 'bull:' + parentQueueName,
          },
        });
        await Job.create(queue, 'testJob3', values[2], {
          parent: {
            id: parent.id,
            queue: 'bull:' + parentQueueName,
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
              queue: 'bull:' + queueName,
            },
          },
        );

        expect(processed2).to.deep.equal({
          [`bull:${queueName}:${child1.id}`]: 'return value1',
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
          [`bull:${queueName}:${child1.id}`]: 'return value1',
          [`bull:${queueName}:${child2.id}`]: 'return value2',
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
        const movedToWaitingChildren2 = await parent.moveToWaitingChildren(
          parentToken,
        );

        expect(processed4).to.deep.equal({
          [`bull:${queueName}:${child1.id}`]: 'return value1',
          [`bull:${queueName}:${child2.id}`]: 'return value2',
          [`bull:${queueName}:${child3.id}`]: 'return value3',
        });
        expect(unprocessed4).to.have.length(0);
        expect(isWaitingChildren2).to.be.false;
        expect(movedToWaitingChildren2).to.be.false;

        await childrenWorker.close();
        await parentWorker.close();

        await parentQueue.close();
        await removeAllQueueData(new IORedis(), parentQueueName);
      });

      describe('when job is not in active state', () => {
        it('throws an error', async () => {
          const values = [{ idx: 0, bar: 'something' }];
          const parentToken = 'parent-token';
          const childToken = 'child-token';

          const parentQueueName = `parent-queue-${v4()}`;

          const parentQueue = new Queue(parentQueueName, { connection });
          const parentWorker = new Worker(parentQueueName, null, {
            connection,
          });
          const childrenWorker = new Worker(queueName, null, { connection });

          const data = { foo: 'bar' };
          await Job.create(parentQueue, 'testDepend', data);

          const parent = (await parentWorker.getNextJob(parentToken)) as Job;
          const currentState = await parent.getState();

          expect(currentState).to.be.equal('active');

          await Job.create(queue, 'testJob1', values[0], {
            parent: {
              id: parent.id,
              queue: 'bull:' + parentQueueName,
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
              queue: 'bull:' + queueName,
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
                queue: 'bull:' + queueName,
              },
            }),
          ).to.be.rejectedWith(
            `Job ${parent.id} is not in the active state. moveToWaitingChildren`,
          );

          await childrenWorker.close();
          await parentWorker.close();

          await parentQueue.close();
          await removeAllQueueData(new IORedis(), parentQueueName);
        });
      });
    });

    it('should get paginated unprocessed dependencies keys', async () => {
      const value = { bar: 'something' };
      const parentToken = 'parent-token';

      const parentQueueName = `parent-queue-${v4()}`;

      const parentQueue = new Queue(parentQueueName, { connection });
      const parentWorker = new Worker(parentQueueName, null, { connection });
      const childrenWorker = new Worker(queueName, null, { connection });

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
                id: parent.id,
                queue: 'bull:' + parentQueueName,
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

      expect(unprocessed1.length).to.be.greaterThanOrEqual(50);

      const { nextUnprocessedCursor: nextCursor2, unprocessed: unprocessed2 } =
        await parent.getDependencies({
          unprocessed: {
            cursor: nextCursor1,
            count: 50,
          },
        });

      expect(unprocessed2.length).to.be.lessThanOrEqual(15);
      expect(nextCursor2).to.be.equal(0);

      await childrenWorker.close();
      await parentWorker.close();

      await parentQueue.close();
      await removeAllQueueData(new IORedis(), parentQueueName);
    });

    it('should allow to fail jobs manually', async () => {
      const worker = new Worker(queueName, null, { connection });
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
      const worker = new Worker(queueName, null, { connection });
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
      const worker = new Worker(queueName, null, { connection });
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
      const worker = new Worker(queueName, null, { connection });
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
    const queueScheduler = new QueueScheduler(queueName, {
      connection,
      stalledInterval: 10,
    });
    await queueScheduler.waitUntilReady();
    const worker = new Worker(
      queueName,
      async () => {
        return delay(100);
      },
      { connection },
    );
    await worker.waitUntilReady();

    await queue.add('test', { foo: 'bar' });

    const allStalled = new Promise<void>(resolve => {
      worker.once('completed', async () => {
        const stalled = await client.scard(`bull:${queueName}:stalled`);
        expect(stalled).to.be.equal(0);
        resolve();
      });
    });

    await allStalled;

    await worker.close();
    await queueScheduler.close();
  });
});
