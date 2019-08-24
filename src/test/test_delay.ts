import { Queue } from '@src/classes';
import { describe, beforeEach, it } from 'mocha';
import { expect } from 'chai';
import IORedis from 'ioredis';
import { v4 } from 'node-uuid';
import { Worker } from '@src/classes/worker';
import { QueueEvents } from '@src/classes/queue-events';
import { QueueScheduler } from '@src/classes/queue-scheduler';

describe('Delayed jobs', function() {
  this.timeout(15000);

  let queue: Queue;
  let queueName: string;
  let client: IORedis.Redis;

  beforeEach(function() {
    client = new IORedis();
    return client.flushdb();
  });

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
  });

  afterEach(async function() {
    await queue.close();
    return client.quit();
  });

  it('should process a delayed job only after delayed time', async function() {
    const delay = 500;
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.init();

    const queueEvents = new QueueEvents(queueName);
    await queueEvents.init();

    const worker = new Worker(queueName, async job => {});

    const timestamp = Date.now();
    let publishHappened = false;

    queueEvents.on('delayed', () => (publishHappened = true));

    const completed = new Promise((resolve, reject) => {
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

    await completed;
    await queueScheduler.close();
  });

  it('should process delayed jobs in correct order', async function() {
    let order = 0;

    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.init();

    const promise = new Promise((resolve, reject) => {
      const worker = new Worker(queueName, async job => {
        order++;
        try {
          expect(order).to.be.equal(job.data.order);
          if (order === 10) {
            await queueScheduler.close();
            await worker.close();
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      });

      worker.on('failed', function(job, err) {
        err.job = job;
        reject(err);
      });
    });

    queue.add('test', { order: 1 }, { delay: 100 });
    queue.add('test', { order: 6 }, { delay: 600 });
    queue.add('test', { order: 10 }, { delay: 1000 });
    queue.add('test', { order: 2 }, { delay: 200 });
    queue.add('test', { order: 9 }, { delay: 900 });
    queue.add('test', { order: 5 }, { delay: 500 });
    queue.add('test', { order: 3 }, { delay: 300 });
    queue.add('test', { order: 7 }, { delay: 700 });
    queue.add('test', { order: 4 }, { delay: 400 });
    queue.add('test', { order: 8 }, { delay: 800 });

    await promise;

    await queueScheduler.close();
  });

  /*
  it('should process delayed jobs in correct order even in case of restart', function(done) {
    this.timeout(15000);

    var QUEUE_NAME = 'delayed queue multiple' + uuid();
    var order = 1;

    queue = new Queue(QUEUE_NAME);

    var fn = function(job, jobDone) {
      expect(order).to.be.equal(job.data.order);
      jobDone();

      if (order === 4) {
        queue.close().then(done, done);
      }

      order++;
    };

    Bluebird.join(
      queue.add({ order: 2 }, { delay: 300 }),
      queue.add({ order: 4 }, { delay: 500 }),
      queue.add({ order: 1 }, { delay: 200 }),
      queue.add({ order: 3 }, { delay: 400 }),
    )
      .then(function() {
        //
        // Start processing so that jobs get into the delay set.
        //
        queue.process(fn);
        return Bluebird.delay(20);
      })
      .then(function() {
        //We simulate a restart
        // console.log('RESTART');
        // return queue.close().then(function () {
        //   console.log('CLOSED');
        //   return Promise.delay(100).then(function () {
        //     queue = new Queue(QUEUE_NAME);
        //     queue.process(fn);
        //   });
        // });
      });
  });
*/

  it('should process delayed jobs with exact same timestamps in correct order (FIFO)', async function() {
    let order = 1;

    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.init();

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

    const promise = new Promise((resolve, reject) => {
      const worker = new Worker(queueName, async job => {
        try {
          expect(order).to.be.equal(job.data.order);

          if (order === 12) {
            await queueScheduler.close();
            await worker.close();
            resolve();
          }
        } catch (err) {
          reject(err);
        }

        order++;
      });

      worker.on('failed', function(job, err) {
        err.job = job;
        reject(err);
      });
    });

    await promise;

    await queueScheduler.close();
  });
});
