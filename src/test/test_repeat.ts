import { Job, Queue } from '@src/classes';
import { QueueEvents } from '@src/classes/queue-events';
import { QueueScheduler } from '@src/classes/queue-scheduler';
import { Repeat } from '@src/classes/repeat';
import { Worker } from '@src/classes/worker';
import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { defaults } from 'lodash';
import { removeAllQueueData } from '@src/utils';

const sinon = require('sinon');
const moment = require('moment');

const ONE_SECOND = 1000;
const ONE_MINUTE = 60 * ONE_SECOND;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;
const MAX_INT = 2147483647;

const NoopProc = async (job: Job) => {};

describe('repeat', function() {
  this.timeout(10000);
  let repeat: Repeat;
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  beforeEach(function() {
    this.clock = sinon.useFakeTimers();
  });

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
    repeat = new Repeat(queueName);
    queueEvents = new QueueEvents(queueName);
    await queueEvents.waitUntilReady();
  });

  afterEach(async function() {
    this.clock.restore();
    await queue.close();
    await repeat.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should create multiple jobs if they have the same cron pattern', async function() {
    const cron = '*/10 * * * * *';

    await Promise.all([
      queue.add('test1', {}, { repeat: { cron: cron } }),
      queue.add('test2', {}, { repeat: { cron: cron } }),
    ]);

    const count = await queue.count();
    expect(count).to.be.eql(2);
  });

  it('should get repeatable jobs with different cron pattern', async function() {
    const crons = [
      '10 * * * * *',
      '2 10 * * * *',
      '1 * * 5 * *',
      '2 * * 4 * *',
    ];

    await Promise.all([
      queue.add('first', {}, { repeat: { cron: crons[0], endDate: 12345 } }),
      queue.add('second', {}, { repeat: { cron: crons[1], endDate: 610000 } }),
      queue.add(
        'third',
        {},
        { repeat: { cron: crons[2], tz: 'Africa/Abidjan' } },
      ),
      queue.add(
        'fourth',
        {},
        { repeat: { cron: crons[3], tz: 'Africa/Accra' } },
      ),
      queue.add(
        'fifth',
        {},
        { repeat: { every: 5000, tz: 'Europa/Copenhaguen' } },
      ),
    ]);
    const count = await repeat.getRepeatableCount();
    expect(count).to.be.eql(5);

    let jobs = await repeat.getRepeatableJobs(0, -1, true);
    jobs = await jobs.sort(function(a, b) {
      return crons.indexOf(a.cron) - crons.indexOf(b.cron);
    });
    expect(jobs)
      .to.be.and.an('array')
      .and.have.length(5)
      .and.to.deep.include({
        key: 'first::12345::10 * * * * *',
        name: 'first',
        id: null,
        endDate: 12345,
        tz: null,
        cron: '10 * * * * *',
        next: 10000,
      })
      .and.to.deep.include({
        key: 'second::610000::2 10 * * * *',
        name: 'second',
        id: null,
        endDate: 610000,
        tz: null,
        cron: '2 10 * * * *',
        next: 602000,
      })
      .and.to.deep.include({
        key: 'fourth:::Africa/Accra:2 * * 4 * *',
        name: 'fourth',
        id: null,
        endDate: null,
        tz: 'Africa/Accra',
        cron: '2 * * 4 * *',
        next: 259202000,
      })
      .and.to.deep.include({
        key: 'third:::Africa/Abidjan:1 * * 5 * *',
        name: 'third',
        id: null,
        endDate: null,
        tz: 'Africa/Abidjan',
        cron: '1 * * 5 * *',
        next: 345601000,
      });
  });

  it('should repeat every 2 seconds', async function() {
    this.timeout(20000);
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const worker = new Worker(queueName, async job => {});

    const date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());

    const nextTick = 2 * ONE_SECOND + 100;

    await queue.add(
      'test',
      { foo: 'bar' },
      { repeat: { cron: '*/2 * * * * *' } },
    );

    this.clock.tick(nextTick);

    let prev: any;
    var counter = 0;

    const completting = new Promise(resolve => {
      worker.on('completed', async job => {
        this.clock.tick(nextTick);
        if (prev) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.timestamp - prev.timestamp).to.be.gte(2000);
        }
        prev = job;
        counter++;
        if (counter == 5) {
          resolve();
        }
      });
    });

    await completting;
    await worker.close();
    await queueScheduler.close();
  });

  it('should repeat every 2 seconds with startDate in future', async function() {
    this.timeout(200000);
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    const nextTick = 2 * ONE_SECOND + 500;
    const delay = 5 * ONE_SECOND + 500;

    const worker = new Worker(queueName, async job => {});

    await queue.add(
      'test',
      { foo: 'bar' },
      {
        repeat: {
          cron: '*/2 * * * * *',
          startDate: new Date('2017-02-07 9:24:05'),
        },
      },
    );

    this.clock.tick(nextTick + delay);

    let prev: Job;
    let counter = 0;

    const completting = new Promise((resolve, reject) => {
      worker.on('completed', async job => {
        this.clock.tick(nextTick);
        if (prev) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.timestamp - prev.timestamp).to.be.gte(2000);
        }
        prev = job;
        counter++;
        if (counter == 5) {
          resolve();
        }
      });
    });

    await completting;

    await queueScheduler.close();
    await worker.close();
  });

  it('should repeat every 2 seconds with startDate in past', async function() {
    this.timeout(200000);
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    const nextTick = 2 * ONE_SECOND + 500;
    const delay = 5 * ONE_SECOND + 500;

    const worker = new Worker(queueName, async job => {});

    await queue.add(
      'repeat',
      { foo: 'bar' },
      {
        repeat: {
          cron: '*/2 * * * * *',
          startDate: new Date('2017-02-07 9:22:00'),
        },
      },
    );

    this.clock.tick(nextTick + delay);

    let prev: Job;
    let counter = 0;

    const completting = new Promise((resolve, reject) => {
      worker.on('completed', async job => {
        this.clock.tick(nextTick);
        if (prev) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.timestamp - prev.timestamp).to.be.gte(2000);
        }
        prev = job;
        counter++;
        if (counter == 5) {
          resolve();
        }
      });
    });

    await completting;
    await queueScheduler.close();
    await worker.close();
  });

  // Skipped until we find a way of simulating time to avoid waiting 5 days
  it.skip('should repeat once a day for 5 days', async function() {
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const date = new Date('2017-05-05 13:12:00');
    this.clock.tick(date.getTime());
    const nextTick = ONE_DAY;

    const worker = new Worker(queueName, async job => {});

    await queue.add(
      'repeat',
      { foo: 'bar' },
      {
        repeat: {
          cron: '0 1 * * *',
          endDate: new Date('2017-05-10 13:12:00'),
        },
      },
    );
    this.clock.tick(nextTick);

    let prev: Job;
    let counter = 0;
    const completting = new Promise((resolve, reject) => {
      queue.on('completed', async job => {
        this.clock.tick(nextTick);
        if (prev) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.timestamp - prev.timestamp).to.be.gte(ONE_DAY);
        }
        prev = job;

        counter++;
        if (counter == 5) {
          const waitingJobs = await queue.getWaiting();
          expect(waitingJobs.length).to.be.eql(0);
          const delayedJobs = await queue.getDelayed();
          expect(delayedJobs.length).to.be.eql(0);
          resolve();
        }
      });
    });

    await completting;
    await queueScheduler.close();
    await worker.close();
  });

  // Skipped until we find a way of simulating time to avoid waiting a month
  it.skip('should repeat 7:th day every month at 9:25', async function(done) {
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const date = new Date('2017-02-02 7:21:42');
    this.clock.tick(date.getTime());

    const worker = new Worker(queueName, async job => {});

    const nextTick = () => {
      const now = moment();
      const nextMonth = moment().add(1, 'months');
      this.clock.tick(nextMonth - now);
    };

    await queue.add(
      'repeat',
      { foo: 'bar' },
      { repeat: { cron: '* 25 9 7 * *' } },
    );
    nextTick();

    let counter = 20;
    let prev: Job;
    worker.on('completed', async job => {
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        const diff = moment(job.timestamp).diff(
          moment(prev.timestamp),
          'months',
          true,
        );
        expect(diff).to.be.gte(1);
      }
      prev = job;

      counter--;
      if (counter == 0) {
        done();
      }
      nextTick();
    });
  });

  it('should create two jobs with the same ids', async function() {
    const options = {
      repeat: {
        cron: '0 1 * * *',
      },
    };

    const p1 = queue.add('test', { foo: 'bar' }, options);
    const p2 = queue.add('test', { foo: 'bar' }, options);

    const jobs = await Promise.all([p1, p2]);
    expect(jobs.length).to.be.eql(2);
    expect(jobs[0].id).to.be.eql(jobs[1].id);
  });

  it('should allow removing a named repeatable job', async function() {
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const numJobs = 3;
    const date = new Date('2017-02-07 9:24:00');
    let prev: Job;
    let counter = 0;

    this.clock.tick(date.getTime());

    const nextTick = ONE_SECOND + 1;
    const repeat = { cron: '*/1 * * * * *' };
    let processor;

    const processing = new Promise((resolve, reject) => {
      processor = async (job: Job) => {
        counter++;
        if (counter == numJobs) {
          await queue.removeRepeatable('remove', repeat);
          this.clock.tick(nextTick);
          const delayed = await queue.getDelayed();
          expect(delayed).to.be.empty;
          resolve();
        } else if (counter > numJobs) {
          reject(Error('should not repeat more than 7 times'));
        }
      };
    });

    const worker = new Worker(queueName, processor);

    await queue.add('remove', { foo: 'bar' }, { repeat });
    this.clock.tick(nextTick);

    worker.on('completed', job => {
      this.clock.tick(nextTick);
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(ONE_SECOND);
      }
      prev = job;
    });

    await processing;
    await queueScheduler.close();
    await worker.close();
  });

  it('should be able to remove repeatable jobs by key', async () => {
    const repeat = { cron: '*/2 * * * * *' };

    await queue.add('remove', { foo: 'bar' }, { repeat });
    const repeatableJobs = await queue.getRepeatableJobs();
    expect(repeatableJobs).to.have.length(1);
    await queue.removeRepeatableByKey(repeatableJobs[0].key);
    const repeatableJobsAfterRemove = await queue.getRepeatableJobs();
    expect(repeatableJobsAfterRemove).to.have.length(0);
  });

  it('should allow removing a customId repeatable job', async function() {
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const date = new Date('2017-02-07 9:24:00');
    let prev: Job;
    let counter = 0;
    let processor;
    const jobId = 'xxxx';

    this.clock.tick(date.getTime());

    const nextTick = 2 * ONE_SECOND + 10;
    const repeat = { cron: '*/2 * * * * *' };

    await queue.add('test', { foo: 'bar' }, { repeat, jobId });

    this.clock.tick(nextTick);

    const processing = new Promise((resolve, reject) => {
      processor = async (job: Job) => {
        counter++;
        if (counter == 4) {
          try {
            await queue.removeRepeatable('test', repeat, jobId);
            this.clock.tick(nextTick);
            const delayed = await queue.getDelayed();
            expect(delayed).to.be.empty;
            resolve();
          } catch (err) {
            reject(err);
          }
        } else if (counter > 4) {
          reject(Error('should not repeat more than 4 times'));
        }
      };
    });

    const worker = new Worker(queueName, processor);
    await worker.waitUntilReady();

    worker.on('completed', job => {
      this.clock.tick(nextTick);
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(2000);
      }
      prev = job;
    });

    await processing;
    await queueScheduler.close();
  });

  it('should not re-add a repeatable job after it has been removed', async function() {
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const repeat = await queue.repeat;

    let worker: Worker;
    const jobId = 'xxxx';
    const date = new Date('2017-02-07 9:24:00');
    const nextTick = 2 * ONE_SECOND + 100;
    const nextRepeatableJob = repeat.addNextRepeatableJob;
    this.clock.tick(date.getTime());

    const repeatOpts = { cron: '*/2 * * * * *' };

    const afterRemoved = new Promise(async resolve => {
      worker = new Worker(queueName, async job => {
        const repeatWorker = await worker.repeat;
        repeatWorker.addNextRepeatableJob = async (...args) => {
          // In order to simulate race condition
          // Make removeRepeatables happen any time after a moveToX is called
          await queue.removeRepeatable('test', defaults({ jobId }, repeatOpts));

          // nextRepeatableJob will now re-add the removed repeatable
          const result = await nextRepeatableJob.apply(repeat, args);
          resolve();
          return result;
        };
      });

      worker.on('completed', () => {
        this.clock.tick(nextTick);
      });
    });

    await queue.add('test', { foo: 'bar' }, { repeat: repeatOpts, jobId });

    this.clock.tick(nextTick);

    await afterRemoved;

    const jobs = await queue.getRepeatableJobs();
    // Repeatable job was recreated
    expect(jobs.length).to.eql(0);

    await queueScheduler.close();
    await worker.close();
  });

  it('should allow adding a repeatable job after removing it', async function() {
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const repeat = {
      cron: '*/5 * * * *',
    };

    const worker = new Worker(queueName, NoopProc);
    await worker.waitUntilReady();

    await queue.add(
      'myTestJob',
      {
        data: '2',
      },
      {
        repeat: repeat,
      },
    );
    let delayed = await queue.getDelayed();
    expect(delayed.length).to.be.eql(1);

    await queue.removeRepeatable('myTestJob', repeat);

    delayed = await queue.getDelayed();
    expect(delayed.length).to.be.eql(0);

    await queue.add('myTestJob', { data: '2' }, { repeat: repeat });

    delayed = await queue.getDelayed();
    expect(delayed.length).to.be.eql(1);

    await worker.close();
    await queueScheduler.close();
  });

  it('should not repeat more than 5 times', async function() {
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    const nextTick = ONE_SECOND + 500;

    const worker = new Worker(queueName, NoopProc);

    await queue.add(
      'repeat',
      { foo: 'bar' },
      { repeat: { limit: 5, cron: '*/1 * * * * *' } },
    );
    this.clock.tick(nextTick);

    var counter = 0;

    const completting = new Promise((resolve, reject) => {
      worker.on('completed', () => {
        this.clock.tick(nextTick);
        counter++;
        if (counter == 5) {
          resolve();
        } else if (counter > 5) {
          reject(Error('should not repeat more than 5 times'));
        }
      });
    });

    await completting;
    await worker.close();
    await queueScheduler.close();
  });

  it('should processes delayed jobs by priority', async function() {
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    let currentPriority = 1;
    const nextTick = 1000;

    let processor;

    const processing = new Promise((resolve, reject) => {
      processor = async (job: Job) => {
        try {
          expect(job.id).to.be.ok;
          expect(job.data.p).to.be.eql(currentPriority++);
        } catch (err) {
          reject(err);
        }

        if (currentPriority > 3) {
          resolve();
        }
      };
    });

    await Promise.all([
      queue.add('test', { p: 1 }, { priority: 1, delay: nextTick * 3 }),
      queue.add('test', { p: 2 }, { priority: 2, delay: nextTick * 2 }),
      queue.add('test', { p: 3 }, { priority: 3, delay: nextTick }),
    ]);

    this.clock.tick(nextTick * 3 + 100);

    const worker = new Worker(queueName, processor);
    await worker.waitUntilReady();

    await processing;

    await worker.close();
    await queueScheduler.close();
  });

  it('should use ".every" as a valid interval', async function() {
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const interval = ONE_SECOND * 2;
    const date = new Date('2017-02-07 9:24:00');

    // Quantize time
    const time = Math.floor(date.getTime() / interval) * interval;
    this.clock.tick(time);

    const nextTick = ONE_SECOND * 2 + 500;

    await queue.add('repeat m', { type: 'm' }, { repeat: { every: interval } });
    await queue.add('repeat s', { type: 's' }, { repeat: { every: interval } });
    this.clock.tick(nextTick);

    const worker = new Worker(queueName, async job => {});
    await worker.waitUntilReady();

    let prevType: string;
    let counter = 0;

    const completting = new Promise(resolve => {
      worker.on('completed', job => {
        this.clock.tick(nextTick);
        if (prevType) {
          expect(prevType).to.not.be.eql(job.data.type);
        }
        prevType = job.data.type;
        counter++;
        if (counter == 20) {
          resolve();
        }
      });
    });

    await completting;
    await worker.close();
    await queueScheduler.close();
  });

  it('should throw an error when using .cron and .every simutaneously', async function() {
    try {
      await queue.add(
        'repeat',
        { type: 'm' },
        { repeat: { every: 5000, cron: '* /1 * * * * *' } },
      );
      throw new Error('The error was not thrown');
    } catch (err) {
      expect(err.message).to.be.eql(
        'Both .cron and .every options are defined for this repeatable job',
      );
    }
  });

  it('should emit a waiting event when adding a repeatable job to the waiting list', async function() {
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    const date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    const nextTick = 1 * ONE_SECOND + 500;

    const worker = new Worker(queueName, async job => {});

    const waiting = new Promise((resolve, reject) => {
      queueEvents.on('waiting', function({ jobId }) {
        try {
          expect(jobId).to.be.equal(
            'repeat:test:16db7a9b166154f5c636abf3c8fe3364:' +
              (date.getTime() + 1 * ONE_SECOND),
          );
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await queue.add(
      'test',
      { foo: 'bar' },
      { repeat: { cron: '*/1 * * * * *' } },
    );
    this.clock.tick(nextTick);

    await waiting;
    await worker.close();
    await queueScheduler.close();
  });

  it('should have the right count value', async function() {
    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    await queue.add('test', { foo: 'bar' }, { repeat: { every: 1000 } });
    this.clock.tick(ONE_SECOND + 100);

    let processor;
    const processing = new Promise((resolve, reject) => {
      processor = async (job: Job) => {
        if (job.opts.repeat.count === 1) {
          resolve();
        } else {
          reject(new Error('repeatable job got the wrong repeat count'));
        }
      };
    });

    const worker = new Worker(queueName, processor);

    await processing;
    await worker.close();
    await queueScheduler.close();
  });
});
