import { Queue, Worker, QueueEvents } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';
import { default as IORedis } from 'ioredis';
import { after } from 'lodash';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { expect } from 'chai';

describe('stalled jobs', function () {
  let queue: Queue;
  let queueName: string;

  const connection = { host: 'localhost' };

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection });
  });

  afterEach(async function () {
    await queue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('process stalled jobs when starting a queue', async function () {
    this.timeout(10000);

    const queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();

    const concurrency = 4;

    const worker = new Worker(
      queueName,
      async () => {
        return delay(10000);
      },
      {
        connection,
        lockDuration: 1000,
        stalledInterval: 100,
        concurrency,
      },
    );

    const allActive = new Promise(resolve => {
      worker.on('active', after(concurrency, resolve));
    });

    await worker.waitUntilReady();

    await Promise.all([
      queue.add('test', { bar: 'baz' }),
      queue.add('test', { bar1: 'baz1' }),
      queue.add('test', { bar2: 'baz2' }),
      queue.add('test', { bar3: 'baz3' }),
    ]);

    await allActive;

    await worker.close(true);

    const worker2 = new Worker(queueName, async job => {}, {
      connection,
      stalledInterval: 100,
      concurrency,
    });

    const allStalledGlobalEvent = new Promise(resolve => {
      queueEvents.on('stalled', after(concurrency, resolve));
    });

    const allStalled = new Promise<void>(resolve => {
      worker2.on(
        'stalled',
        after(concurrency, (jobId, prev) => {
          expect(prev).to.be.equal('active');
          resolve();
        }),
      );
    });

    await allStalled;
    await allStalledGlobalEvent;

    const allCompleted = new Promise(resolve => {
      worker2.on('completed', after(concurrency, resolve));
    });

    await allCompleted;

    await queueEvents.close();
    await worker2.close();
  });

  it('fail stalled jobs that stall more than allowable stalled limit', async function () {
    this.timeout(6000);

    const queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();

    const concurrency = 4;

    const worker = new Worker(
      queueName,
      async () => {
        return delay(10000);
      },
      {
        connection,
        lockDuration: 1000,
        stalledInterval: 100,
        maxStalledCount: 0,
        concurrency,
      },
    );

    const allActive = new Promise(resolve => {
      worker.on('active', after(concurrency, resolve));
    });

    await worker.waitUntilReady();

    await Promise.all([
      queue.add('test', { bar: 'baz' }),
      queue.add('test', { bar1: 'baz1' }),
      queue.add('test', { bar2: 'baz2' }),
      queue.add('test', { bar3: 'baz3' }),
    ]);

    await allActive;

    await worker.close(true);

    const worker2 = new Worker(queueName, async job => {}, {
      connection,
      stalledInterval: 100,
      maxStalledCount: 0,
      concurrency,
    });

    const errorMessage = 'job stalled more than allowable limit';
    const allFailed = new Promise<void>(resolve => {
      worker2.on(
        'failed',
        after(concurrency, async (job, failedReason, prev) => {
          expect(job.finishedOn).to.be.an('number');
          expect(prev).to.be.equal('active');
          expect(failedReason.message).to.be.equal(errorMessage);
          resolve();
        }),
      );
    });

    const globalAllFailed = new Promise<void>(resolve => {
      queueEvents.on('failed', ({ failedReason }) => {
        expect(failedReason).to.be.equal(errorMessage);
        resolve();
      });
    });

    await allFailed;
    await globalAllFailed;

    await queueEvents.close();
    await worker2.close();
  });

  describe('when stalled jobs stall more than allowable stalled limit', function () {
    it('moves jobs to failed', async function () {
      this.timeout(6000);

      const queueEvents = new QueueEvents(queueName, { connection });
      await queueEvents.waitUntilReady();

      const concurrency = 4;

      const worker = new Worker(
        queueName,
        async () => {
          return delay(10000);
        },
        {
          connection,
          lockDuration: 1000,
          stalledInterval: 100,
          maxStalledCount: 0,
          concurrency,
        },
      );

      const allActive = new Promise(resolve => {
        worker.on('active', after(concurrency, resolve));
      });

      await worker.waitUntilReady();

      await Promise.all([
        queue.add('test', { bar: 'baz' }, { removeOnFail: true }),
        queue.add('test', { bar1: 'baz1' }, { removeOnFail: true }),
        queue.add('test', { bar2: 'baz2' }, { removeOnFail: true }),
        queue.add('test', { bar3: 'baz3' }, { removeOnFail: true }),
      ]);

      await allActive;

      await worker.close(true);

      const worker2 = new Worker(queueName, async job => {}, {
        connection,
        stalledInterval: 100,
        maxStalledCount: 0,
        concurrency,
      });

      const errorMessage = 'job stalled more than allowable limit';
      const allFailed = new Promise<void>(resolve => {
        worker2.on(
          'failed',
          after(concurrency, async (job, failedReason, prev) => {
            expect(job).to.be.undefined;
            expect(prev).to.be.equal('active');
            expect(failedReason.message).to.be.equal(errorMessage);
            resolve();
          }),
        );
      });

      const globalAllFailed = new Promise<void>(resolve => {
        queueEvents.on('failed', ({ failedReason }) => {
          expect(failedReason).to.be.equal(errorMessage);
          resolve();
        });
      });

      await allFailed;
      await globalAllFailed;

      await queueEvents.close();
      await worker2.close();
    });

    describe('when removeOnFail is provided as a number', function () {
      it('keeps the specified number of jobs in failed', async function () {
        this.timeout(6000);
        const concurrency = 4;

        const worker = new Worker(
          queueName,
          async () => {
            return delay(10000);
          },
          {
            connection,
            lockDuration: 1000,
            stalledInterval: 100,
            maxStalledCount: 0,
            concurrency,
          },
        );

        const allActive = new Promise(resolve => {
          worker.on('active', after(concurrency, resolve));
        });

        await worker.waitUntilReady();

        const jobs = Array.from(Array(4).keys()).map(index => ({
          name: 'test',
          data: { index },
          opts: {
            removeOnFail: 3,
          },
        }));

        await queue.addBulk(jobs);

        await allActive;

        await worker.close(true);

        const worker2 = new Worker(queueName, async job => {}, {
          connection,
          stalledInterval: 100,
          maxStalledCount: 0,
          concurrency,
        });

        const errorMessage = 'job stalled more than allowable limit';
        const allFailed = new Promise<void>(resolve => {
          worker2.on(
            'failed',
            after(concurrency, async (job, failedReason, prev) => {
              const failedCount = await queue.getFailedCount();
              expect(failedCount).to.equal(3);

              expect(job.data.index).to.be.equal(3);
              expect(prev).to.be.equal('active');
              expect(failedReason.message).to.be.equal(errorMessage);
              resolve();
            }),
          );
        });

        await allFailed;

        await worker2.close();
      });
    });

    describe('when removeOnFail is provided as boolean', function () {
      it('keeps the jobs with removeOnFail as false in failed', async function () {
        this.timeout(6000);
        const concurrency = 4;

        const worker = new Worker(
          queueName,
          async () => {
            return delay(10000);
          },
          {
            connection,
            lockDuration: 1000,
            stalledInterval: 100,
            maxStalledCount: 0,
            concurrency,
          },
        );

        const allActive = new Promise(resolve => {
          worker.on('active', after(concurrency, resolve));
        });

        await worker.waitUntilReady();

        const jobs = Array.from(Array(4).keys()).map(index => ({
          name: 'test',
          data: { index },
          opts: {
            removeOnFail: index % 2 == 1,
          },
        }));

        await queue.addBulk(jobs);

        await allActive;

        await worker.close(true);

        const worker2 = new Worker(queueName, async job => {}, {
          connection,
          stalledInterval: 100,
          maxStalledCount: 0,
          concurrency,
        });

        const errorMessage = 'job stalled more than allowable limit';
        const allFailed = new Promise<void>(resolve => {
          worker2.on(
            'failed',
            after(concurrency, async (job, failedReason, prev) => {
              expect(job).to.be.undefined;
              const failedCount = await queue.getFailedCount();
              expect(failedCount).to.equal(2);

              expect(prev).to.be.equal('active');
              expect(failedReason.message).to.be.equal(errorMessage);
              resolve();
            }),
          );
        });

        await allFailed;

        await worker2.close();
      });
    });

    describe('when removeOnFail is provided as a object', function () {
      it('keeps the specified number of jobs in failed respecting the age', async function () {
        this.timeout(6000);
        const concurrency = 4;

        const worker = new Worker(
          queueName,
          async job => {
            if (job.data.index < 2) {
              throw new Error('fail');
            }
            return delay(10000);
          },
          {
            connection,
            lockDuration: 1000,
            stalledInterval: 100,
            maxStalledCount: 0,
            concurrency,
          },
        );

        const allActive = new Promise(resolve => {
          worker.on('active', after(concurrency, resolve));
        });

        await worker.waitUntilReady();

        const jobs = Array.from(Array(4).keys()).map(index => ({
          name: 'test',
          data: { index },
          opts: {
            removeOnFail: {
              count: 4,
              age: 1,
            },
          },
        }));

        await queue.addBulk(jobs);

        await allActive;

        await worker.close(true);

        const worker2 = new Worker(queueName, async job => {}, {
          connection,
          stalledInterval: 100,
          maxStalledCount: 0,
          concurrency,
        });

        const errorMessage = 'job stalled more than allowable limit';
        const allFailed = new Promise<void>(resolve => {
          worker2.on('failed', async (job, failedReason, prev) => {
            if (job.id == '4') {
              const failedCount = await queue.getFailedCount();
              expect(failedCount).to.equal(2);

              expect(job.data.index).to.be.equal(3);
              expect(prev).to.be.equal('active');
              expect(failedReason.message).to.be.equal(errorMessage);
              resolve();
            }
          });
        });

        await allFailed;

        await worker2.close();
      });
    });
  });

  it('jobs not stalled while lock is extended', async function () {
    this.timeout(5000);
    const numJobs = 4;

    const concurrency = 4;

    const worker = new Worker(
      queueName,
      async () => {
        return delay(4000);
      },
      {
        connection,
        lockDuration: 100, // lockRenewTime would be half of it i.e. 500
        stalledInterval: 50,
        concurrency,
      },
    );

    const allActive = new Promise(resolve => {
      worker.on('active', after(concurrency, resolve));
    });

    const jobs = Array.from(Array(numJobs).keys()).map(index => ({
      name: 'test',
      data: { bar: `baz-${index}` },
    }));

    await queue.addBulk(jobs);

    await allActive;

    const worker2 = new Worker(queueName, async job => {}, {
      connection,
      stalledInterval: 50,
      concurrency,
    });

    const allStalled = new Promise(resolve =>
      worker2.on('stalled', after(concurrency, resolve)),
    );

    await delay(500); // Wait for jobs to become active

    const active = await queue.getActiveCount();
    expect(active).to.be.equal(4);

    await worker.close(true);

    await allStalled;

    await worker2.close();
  });
});
