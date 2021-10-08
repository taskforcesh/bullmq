import { Queue, Job, Worker, QueueEvents, QueueScheduler } from '../classes';
import { describe, beforeEach, it } from 'mocha';
import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { v4 } from 'uuid';
import { removeAllQueueData } from '../utils';

describe('Delayed jobs', function() {
  this.timeout(15000);

  let queue: Queue;
  let queueName: string;

  beforeEach(async function() {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName);
  });

  afterEach(async function() {
    await queue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should process a delayed job only after delayed time', async function() {
    const delay = 1000;
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();
    const queueEvents = new QueueEvents(queueName);
    await queueEvents.waitUntilReady();

    const worker = new Worker(queueName, async job => {});

    const timestamp = Date.now();
    let publishHappened = false;

    const delayed = new Promise<void>((resolve, reject) => {
      queueEvents.on('delayed', () => {
        publishHappened = true;
        resolve();
      });
    });

    const completed = new Promise<void>((resolve, reject) => {
      queueEvents.on('completed', async function() {
        try {
          expect(Date.now() > timestamp + delay);
          const jobs = await queue.getWaiting();
          expect(jobs.length).to.be.equal(0);

          const delayedJobs = await queue.getDelayed();
          expect(delayedJobs.length).to.be.equal(0);
          expect(publishHappened).to.be.eql(true);
          await worker.close();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    const job = await queue.add('test', { delayed: 'foobar' }, { delay });

    expect(job.id).to.be.ok;
    expect(job.data.delayed).to.be.eql('foobar');
    expect(job.opts.delay).to.be.eql(delay);

    await delayed;
    await completed;
    await queueScheduler.close();
    await queueEvents.close();
    await worker.close();
  });

  describe('when autorun option is provided as false', function() {
    it('should process a delayed job only after delayed time', async function() {
      const delay = 1000;
      const queueScheduler = new QueueScheduler(queueName, { autorun: false });
      await queueScheduler.waitUntilReady();
      const queueEvents = new QueueEvents(queueName);
      await queueEvents.waitUntilReady();

      const worker = new Worker(queueName, async job => {});

      const timestamp = Date.now();
      let publishHappened = false;

      const delayed = new Promise<void>((resolve, reject) => {
        queueEvents.on('delayed', () => {
          publishHappened = true;
          resolve();
        });
      });

      const completed = new Promise<void>((resolve, reject) => {
        queueEvents.on('completed', async function() {
          try {
            expect(Date.now() > timestamp + delay);
            const jobs = await queue.getWaiting();
            expect(jobs.length).to.be.equal(0);

            const delayedJobs = await queue.getDelayed();
            expect(delayedJobs.length).to.be.equal(0);
            expect(publishHappened).to.be.eql(true);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      const job = await queue.add('test', { delayed: 'foobar' }, { delay });

      expect(job.id).to.be.ok;
      expect(job.data.delayed).to.be.eql('foobar');
      expect(job.opts.delay).to.be.eql(delay);

      queueScheduler.run();

      await delayed;
      await completed;
      await queueScheduler.close();
      await queueEvents.close();
      await worker.close();
    });

    describe('when run method is called when queue-scheduler is running', function() {
      it('throws an error', async function() {
        const delay = 1000;
        const maxJobs = 10;
        const queueScheduler = new QueueScheduler(queueName, {
          autorun: false,
        });
        await queueScheduler.waitUntilReady();

        const worker = new Worker(queueName, async job => {});
        queueScheduler.run();

        for (let i = 1; i <= maxJobs; i++) {
          await queue.add('test', { foo: 'bar', num: i }, { delay });
        }

        await expect(queueScheduler.run()).to.be.rejectedWith(
          'Queue Scheduler is already running.',
        );

        await queueScheduler.close();
        await worker.close();
      });
    });
  });

  it('should process delayed jobs in correct order', async function() {
    this.timeout(2000);
    let order = 0;
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    let processor;

    const processing = new Promise<void>((resolve, reject) => {
      processor = async (job: Job) => {
        order++;
        try {
          expect(order).to.be.equal(job.data.order);
          if (order === 10) {
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      };
    });

    const worker = new Worker(queueName, processor);

    worker.on('failed', function(job, err) {});

    await Promise.all([
      queue.add('test', { order: 1 }, { delay: 100 }),
      queue.add('test', { order: 6 }, { delay: 600 }),
      queue.add('test', { order: 10 }, { delay: 1000 }),
      queue.add('test', { order: 2 }, { delay: 200 }),
      queue.add('test', { order: 9 }, { delay: 900 }),
      queue.add('test', { order: 5 }, { delay: 500 }),
      queue.add('test', { order: 3 }, { delay: 300 }),
      queue.add('test', { order: 7 }, { delay: 700 }),
      queue.add('test', { order: 4 }, { delay: 400 }),
      queue.add('test', { order: 8 }, { delay: 800 }),
    ]);

    await processing;

    await queueScheduler.close();
    await worker.close();
  });

  it('should process delayed jobs in correct order even in case of restart', async function() {
    this.timeout(5000);

    let worker: Worker;
    let order = 1;

    let secondQueueScheduler: QueueScheduler;
    const firstQueueScheduler = new QueueScheduler(queueName);
    await firstQueueScheduler.waitUntilReady();

    queue = new Queue(queueName);

    const processing = new Promise<void>((resolve, reject) => {
      worker = new Worker(queueName, async (job: Job) => {
        try {
          expect(order).to.be.equal(job.data.order);

          if (order === 1) {
            await firstQueueScheduler.close();
            secondQueueScheduler = new QueueScheduler(queueName);
            await secondQueueScheduler.waitUntilReady();
          }

          if (order === 4) {
            resolve();
          }
          order++;
        } catch (err) {
          reject(err);
        }
      });
    });

    await Promise.all([
      queue.add('test', { order: 2 }, { delay: 500 }),
      queue.add('test', { order: 4 }, { delay: 1500 }),
      queue.add('test', { order: 1 }, { delay: 200 }),
      queue.add('test', { order: 3 }, { delay: 800 }),
    ]);

    await processing;

    await queue.close();
    worker && (await worker.close());
    secondQueueScheduler && (await secondQueueScheduler.close());
  });

  it('should process delayed jobs with exact same timestamps in correct order (FIFO)', async function() {
    let order = 1;

    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    let worker: Worker;
    const processing = new Promise((resolve, reject) => {
      worker = new Worker(queueName, async (job: Job) => {
        try {
          expect(order).to.be.equal(job.data.order);

          if (order === 12) {
            resolve(worker.close());
          }
        } catch (err) {
          reject(err);
        }

        order++;
      });
    });

    worker.on('failed', function(job, err) {});

    const now = Date.now();
    const promises = [];
    let i = 1;
    for (i; i <= 12; i++) {
      promises.push(
        queue.add(
          'test',
          { order: i },
          {
            delay: 1000,
            timestamp: now,
          },
        ),
      );
    }
    await Promise.all(promises);
    await processing;
    await queueScheduler.close();
    await worker.close();
  });
});
