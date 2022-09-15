import { Queue, Job, Worker, QueueEvents } from '../src/classes';
import { describe, beforeEach, it } from 'mocha';
import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { v4 } from 'uuid';
import { removeAllQueueData, delay } from '../src/utils';

describe('Delayed jobs', function () {
  this.timeout(15000);

  let queue: Queue;
  let queueName: string;

  const connection = { host: 'localhost' };

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection });
    await queue.waitUntilReady();
  });

  afterEach(async function () {
    await queue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should process a delayed job only after delayed time', async function () {
    const delay = 1000;
    const margin = 1.2;

    const queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();

    const worker = new Worker(queueName, async () => {}, { connection });
    await worker.waitUntilReady();

    const timestamp = Date.now();
    let publishHappened = false;

    const delayed = new Promise<void>(resolve => {
      queueEvents.on('delayed', () => {
        publishHappened = true;
        resolve();
      });
    });

    const completed = new Promise<void>((resolve, reject) => {
      worker.on('completed', async function (job) {
        try {
          expect(Date.now() > timestamp + delay);
          expect(job.processedOn! - job.timestamp).to.be.greaterThanOrEqual(
            delay,
          );
          expect(
            job.processedOn! - job.timestamp,
            'processedOn is not within margin',
          ).to.be.lessThan(delay * margin);

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
    expect(job.delay).to.be.eql(delay);

    await delayed;
    await completed;
    await queueEvents.close();
    await worker.close();
  });

  it('should process delayed jobs in correct order respecting delay', async function () {
    this.timeout(3500);
    let order = 0;
    const numJobs = 12;
    const margin = 1.2;

    let processor;

    const processing = new Promise<void>((resolve, reject) => {
      processor = async (job: Job) => {
        order++;
        try {
          expect(order).to.be.equal(job.data.order);
          expect(job.processedOn! - job.timestamp).to.be.greaterThanOrEqual(
            job.delay,
          );
          expect(
            job.processedOn! - job.timestamp,
            'processedOn is not within margin',
          ).to.be.lessThan(job.delay * margin);

          if (order === numJobs) {
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      };
    });

    const worker = new Worker(queueName, processor, { connection });

    worker.on('failed', function (job, err) {});

    const jobs = Array.from(Array(numJobs).keys()).map(index => ({
      name: 'test',
      data: { order: numJobs - index },
      opts: {
        delay: 500 + (numJobs - index) * 150,
      },
    }));

    await queue.addBulk(jobs);
    await processing;
    await worker.close();
  });

  it('should process delayed jobs concurrently respecting delay', async function () {
    this.timeout(35000);
    let order = 0;
    const numJobs = 12;
    const margin = 1.25;

    let processor;

    const processing = new Promise<void>((resolve, reject) => {
      processor = async (job: Job) => {
        order++;
        try {
          expect(order).to.be.equal(job.data.order);
          expect(
            job.processedOn! - job.timestamp,
            'waited at least delay time',
          ).to.be.greaterThanOrEqual(job.delay);
          expect(
            job.processedOn! - job.timestamp,
            'processedOn is not within margin',
          ).to.be.lessThan(job.delay * margin);

          if (order === numJobs) {
            resolve();
          }
        } catch (err) {
          reject(err);
        }

        await delay(1000);
      };
    });

    const worker = new Worker(queueName, processor, {
      connection,
      concurrency: numJobs / 2,
    });

    const worker2 = new Worker(queueName, processor, {
      connection,
      concurrency: numJobs / 2,
    });

    await worker.waitUntilReady();
    await worker2.waitUntilReady();

    const jobs = Array.from(Array(numJobs).keys()).map(index => ({
      name: 'test',
      data: { order: numJobs - index },
      opts: {
        delay: 500 + (numJobs - index),
      },
    }));

    await queue.addBulk(jobs);
    await processing;
    await worker.close();
    await worker2.close();
  });

  it('should process delayed jobs with exact same timestamps in correct order (FIFO)', async function () {
    let order = 1;
    const numJobs = 27;

    let worker: Worker;
    const processing = new Promise<void>((resolve, reject) => {
      worker = new Worker(
        queueName,
        async (job: Job) => {
          try {
            expect(order).to.be.equal(job.data.order);

            if (order === numJobs) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }

          order++;
        },
        { connection },
      );

      worker.on('failed', function (job, err) {
        reject();
      });
    });

    const now = Date.now();
    const promises: Promise<Job<any, any, string>>[] = [];
    let i = 1;
    for (i; i <= numJobs; i++) {
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
    await worker!.close();
  });

  describe('when autorun option is provided as false', function () {
    it('should process a delayed job only after delayed time', async function () {
      const delay = 1000;
      const queueEvents = new QueueEvents(queueName, { connection });
      await queueEvents.waitUntilReady();

      const worker = new Worker(queueName, async () => {}, {
        connection,
        autorun: false,
      });
      await worker.waitUntilReady();

      const timestamp = Date.now();
      let publishHappened = false;

      const delayed = new Promise<void>(resolve => {
        queueEvents.on('delayed', () => {
          publishHappened = true;
          resolve();
        });
      });

      const completed = new Promise<void>((resolve, reject) => {
        queueEvents.on('completed', async function () {
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

      worker.run();

      await delayed;
      await completed;
      await queueEvents.close();
      await worker.close();
    });
  });
});
