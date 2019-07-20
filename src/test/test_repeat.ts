import { Queue, Job } from '@src/classes';
import { describe, beforeEach, it } from 'mocha';
import { expect } from 'chai';
import IORedis from 'ioredis';
import { v4 } from 'node-uuid';
import { Worker } from '@src/classes/worker';
import { after } from 'lodash';
import { QueueEvents } from '@src/classes/queue-events';
import { Repeat } from '@src/classes/repeat';
import { QueueKeeper } from '@src/classes/queue-keeper';

// const utils = require('./utils');
const sinon = require('sinon');
const moment = require('moment');
const _ = require('lodash');

const ONE_SECOND = 1000;
const ONE_MINUTE = 60 * ONE_SECOND;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;
const MAX_INT = 2147483647;

describe('repeat', function() {
  this.timeout(10000);
  let repeat: Repeat;
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;
  let client: IORedis.Redis;

  beforeEach(function() {
    this.clock = sinon.useFakeTimers();
    client = new IORedis();
    return client.flushdb();
  });

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
    repeat = new Repeat(queueName);
    queueEvents = new QueueEvents(queueName);
    return queueEvents.init();
  });

  afterEach(async function() {
    this.clock.restore();
    await queue.close();
    await repeat.close();
    await queueEvents.close();
    return client.quit();
  });

  it('should create multiple jobs if they have the same cron pattern', async function() {
    const cron = '*/10 * * * * *';
    const customJobIds = ['customjobone', 'customjobtwo'];

    await Promise.all([
      queue.append(
        'test',
        {},
        { jobId: customJobIds[0], repeat: { cron: cron } },
      ),
      queue.append(
        'test',
        {},
        { jobId: customJobIds[1], repeat: { cron: cron } },
      ),
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
      queue.append('first', {}, { repeat: { cron: crons[0], endDate: 12345 } }),
      queue.append(
        'second',
        {},
        { repeat: { cron: crons[1], endDate: 610000 } },
      ),
      queue.append(
        'third',
        {},
        { repeat: { cron: crons[2], tz: 'Africa/Abidjan' } },
      ),
      queue.append(
        'fourth',
        {},
        { repeat: { cron: crons[3], tz: 'Africa/Accra' } },
      ),
    ]);
    const count = await repeat.getRepeatableCount();
    expect(count).to.be.eql(4);

    let jobs = await repeat.getRepeatableJobs(0, -1, true);
    jobs = await jobs.sort(function(a, b) {
      return crons.indexOf(a.cron) - crons.indexOf(b.cron);
    });
    expect(jobs)
      .to.be.and.an('array')
      .and.have.length(4)
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
    this.timeout(200000);
    const queueKeeper = new QueueKeeper(queueName);
    await queueKeeper.init();

    const worker = new Worker(queueName, async job => {
      console.log('Working...');
    });

    const date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());

    const nextTick = 2 * ONE_SECOND + 500;

    await queue.append(
      'repeat',
      { foo: 'bar' },
      { repeat: { cron: '*/2 * * * * *' } },
    );

    this.clock.tick(nextTick);

    let prev: any;
    var counter = 0;

    return new Promise(resolve => {
      worker.on('completed', async job => {
        this.clock.tick(nextTick);
        if (prev) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.timestamp - prev.timestamp).to.be.gte(2000);
        }
        prev = job;
        counter++;
        console.log('COUNTER', counter);
        if (counter == 5) {
          await worker.close();
          resolve();
        }
      });
    });
  });

  it('should repeat every 2 seconds with startDate in future', async function() {
    this.timeout(200000);
    const queueKeeper = new QueueKeeper(queueName);
    await queueKeeper.init();

    const date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    const nextTick = 2 * ONE_SECOND + 500;
    const delay = 5 * ONE_SECOND + 500;

    const worker = new Worker(queueName, async job => {
      console.log('Working...');
    });

    await queue.append(
      'repeat',
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

    return new Promise((resolve, reject) => {
      worker.on('completed', async job => {
        this.clock.tick(nextTick);
        if (prev) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.timestamp - prev.timestamp).to.be.gte(2000);
        }
        prev = job;
        counter++;
        console.log('COUNTER', counter);
        if (counter == 5) {
          resolve();
          await queueKeeper.close();
        }
      });
    });
  });

  it('should repeat every 2 seconds with startDate in past', async function() {
    this.timeout(200000);
    const queueKeeper = new QueueKeeper(queueName);
    await queueKeeper.init();

    const date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    const nextTick = 2 * ONE_SECOND + 500;
    const delay = 5 * ONE_SECOND + 500;

    const worker = new Worker(queueName, async job => {
      console.log('Working...');
    });

    await queue.append(
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

    return new Promise((resolve, reject) => {
      worker.on('completed', async job => {
        this.clock.tick(nextTick);
        if (prev) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.timestamp - prev.timestamp).to.be.gte(2000);
        }
        prev = job;
        counter++;
        console.log('COUNTER', counter);
        if (counter == 5) {
          resolve();
          await queueKeeper.close();
        }
      });
    });
  });

  // Skipped until we find a way of simulating time to avoid waiting 5 days
  it.skip('should repeat once a day for 5 days', async function() {
    const queueKeeper = new QueueKeeper(queueName);
    await queueKeeper.init();

    const date = new Date('2017-05-05 13:12:00');
    this.clock.tick(date.getTime());
    const nextTick = ONE_DAY;

    const worker = new Worker(queueName, async job => {
      console.log('Working...');
    });

    await queue.append(
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
    return new Promise((resolve, reject) => {
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
          await queueKeeper.close();
          await worker.close();
          resolve();
        }
      });
    });
  });

  // Skipped until we find a way of simulating time to avoid waiting a month
  it.skip('should repeat 7:th day every month at 9:25', async function(done) {
    const queueKeeper = new QueueKeeper(queueName);
    await queueKeeper.init();

    const date = new Date('2017-02-02 7:21:42');
    this.clock.tick(date.getTime());

    const worker = new Worker(queueName, async job => {
      console.log('Working...');
    });

    const nextTick = () => {
      const now = moment();
      const nextMonth = moment().add(1, 'months');
      this.clock.tick(nextMonth - now);
    };

    await queue.append(
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

    const p1 = queue.append('test', { foo: 'bar' }, options);
    const p2 = queue.append('test', { foo: 'bar' }, options);

    const jobs = await Promise.all([p1, p2]);
    expect(jobs.length).to.be.eql(2);
    expect(jobs[0].id).to.be.eql(jobs[1].id);
  });

  it('should allow removing a named repeatable job', async function(done) {
    const date = new Date('2017-02-07 9:24:00');
    let prev: Job;
    let counter = 0;

    this.clock.tick(date.getTime());

    const nextTick = 2 * ONE_SECOND;
    const repeat = { cron: '*/2 * * * * *' };

    const worker = new Worker(queueName, async job => {
      counter++;
      if (counter == 20) {
        await queue.removeRepeatable('remove', repeat);
        this.clock.tick(nextTick);
        const delayed = await queue.getDelayed();
        expect(delayed).to.be.empty;
        done();
      } else if (counter > 20) {
        done(Error('should not repeat more than 20 times'));
      }
    });

    await queue.append('remove', { foo: 'bar' }, { repeat: repeat });
    this.clock.tick(nextTick);

    worker.on('completed', job => {
      this.clock.tick(nextTick);
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(2000);
      }
      prev = job;
    });
  });

  it('should allow removing a customId repeatable job', async function(done) {
    const date = new Date('2017-02-07 9:24:00');
    let prev: Job;
    let counter = 0;

    this.clock.tick(date.getTime());

    const nextTick = 2 * ONE_SECOND;
    const repeat = { cron: '*/2 * * * * *' };

    await queue.append(
      'test',
      { foo: 'bar' },
      { repeat: repeat, jobId: 'xxxx' },
    );
    this.clock.tick(nextTick);

    const worker = new Worker(queueName, async job => {
      counter++;
      if (counter == 20) {
        await queue.removeRepeatable(
          'test',
          _.defaults({ jobId: 'xxxx' }, repeat),
        );
        this.clock.tick(nextTick);
        const delayed = await queue.getDelayed();
        expect(delayed).to.be.empty;
        done();
      } else if (counter > 20) {
        done(Error('should not repeat more than 20 times'));
      }
    });

    worker.on('completed', job => {
      this.clock.tick(nextTick);
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(2000);
      }
      prev = job;
    });
  });

  it('should not re-add a repeatable job after it has been removed', async function() {
    const date = new Date('2017-02-07 9:24:00');
    const nextTick = 2 * ONE_SECOND;
    const repeat = { cron: '* /2 * * * * *' };
    const nextRepeatableJob = queue.repeat.addNextRepeatableJob;
    this.clock.tick(date.getTime());

    const afterRemoved = new Promise(async resolve => {
      const worker = new Worker(queueName, async job => {
        queue.repeat.addNextRepeatableJob = async (...args) => {
          // In order to simulate race condition
          // Make removeRepeatables happen any time after a moveToX is called
          await queue.repeat.removeRepeatable(
            'test',
            _.defaults({ jobId: 'xxxx' }, repeat),
          );

          // nextRepeatableJob will now re-add the removed repeatable
          const result = await nextRepeatableJob.apply(queue.repeat, args);
          resolve();
          return result;
        };
      });

      await queue.append(
        'test',
        { foo: 'bar' },
        { repeat: repeat, jobId: 'xxxx' },
      );
      this.clock.tick(nextTick);

      worker.on('completed', () => {
        this.clock.tick(nextTick);
      });
    });

    await afterRemoved;

    const jobs = await queue.repeat.getRepeatableJobs();
    // Repeatable job was recreated
    expect(jobs.length).to.eql(0);
  });

  it('should allow adding a repeatable job after removing it', async function() {
    const repeat = {
      cron: '* /5 * * * *',
    };

    const worker = new Worker(queueName, async job => {
      // dummy processor
    });

    await queue.append(
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

    await queue.append('myTestJob', { data: '2' }, { repeat: repeat });

    delayed = await queue.getDelayed();
    expect(delayed.length).to.be.eql(1);
  });

  it('should not repeat more than 5 times', function(done) {
    const date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    const nextTick = ONE_SECOND + 500;

    const worker = new Worker(queueName, async job => {
      // dummy processor
    });

    queue.append(
      'repeat',
      { foo: 'bar' },
      { repeat: { limit: 5, cron: '* /1 * * * * *' } },
    );
    this.clock.tick(nextTick);

    var counter = 0;
    worker.on('completed', () => {
      this.clock.tick(nextTick);
      counter++;
      if (counter == 5) {
        done();
      } else if (counter > 5) {
        done(Error('should not repeat more than 5 times'));
      }
    });
  });

  it('should processes delayed jobs by priority', async function(done) {
    const jobAdds = [];
    let currentPriority = 1;
    const nextTick = 1000;

    jobAdds.push(
      queue.append('test', { p: 1 }, { priority: 1, delay: nextTick * 3 }),
    );
    jobAdds.push(
      queue.append('test', { p: 2 }, { priority: 2, delay: nextTick * 2 }),
    );
    jobAdds.push(
      queue.append('test', { p: 3 }, { priority: 3, delay: nextTick }),
    );

    this.clock.tick(nextTick * 3);

    await Promise.all(jobAdds);

    const worker = new Worker(queueName, async job => {
      // dummy processor
      try {
        expect(job.id).to.be.ok;
        expect(job.data.p).to.be.eql(currentPriority++);
      } catch (err) {
        done(err);
      }

      if (currentPriority > 3) {
        done();
      }
    });
  });

  // Skip test that only fails on travis
  it('should use ".every" as a valid interval', async function(done) {
    const interval = ONE_SECOND * 2;
    const date = new Date('2017-02-07 9:24:00');

    // Quantize time
    const time = Math.floor(date.getTime() / interval) * interval;
    this.clock.tick(time);

    const nextTick = ONE_SECOND * 2 + 500;

    await queue.append(
      'repeat m',
      { type: 'm' },
      { repeat: { every: interval } },
    );
    await queue.append(
      'repeat s',
      { type: 's' },
      { repeat: { every: interval } },
    );
    this.clock.tick(nextTick);

    const worker = new Worker(queueName, async job => {
      // dummy processor
    });

    let prevType: string;
    let counter = 0;
    worker.on('completed', job => {
      this.clock.tick(nextTick);
      if (prevType) {
        expect(prevType).to.not.be.eql(job.data.type);
      }
      prevType = job.data.type;
      counter++;
      if (counter == 20) {
        done();
      }
    });
  });

  it('should throw an error when using .cron and .every simutaneously', async function() {
    try {
      await queue.append(
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

  // This tests works well locally but fails in travis for some unknown reason.
  it('should emit a waiting event when adding a repeatable job to the waiting list', async function(done) {
    const date = new Date('2017-02-07 9:24:00');
    this.clock.tick(date.getTime());
    const nextTick = 2 * ONE_SECOND + 500;

    const worker = new Worker(queueName, async job => {
      // dummy processor
    });

    worker.on('waiting', function(jobId) {
      expect(jobId).to.be.equal(
        'repeat:93168b0ea97b55fb5a8325e8c66e4300:' +
          (date.getTime() + 2 * ONE_SECOND),
      );
      done();
    });

    await queue.append(
      'repeat',
      { foo: 'bar' },
      { repeat: { cron: '* /2 * * * * *' } },
    );
    this.clock.tick(nextTick);
  });

  it('should have the right count value', async function(done) {
    await queue.append('test', { foo: 'bar' }, { repeat: { every: 1000 } });
    this.clock.tick(ONE_SECOND);

    const worker = new Worker(queueName, async job => {
      if (job.opts.repeat.count === 1) {
        done();
      } else {
        done(Error('repeatable job got the wrong repeat count'));
      }
    });
  });
});
