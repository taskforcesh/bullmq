import { default as IORedis } from '@sinianluoye/ioredis';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import * as sinon from 'sinon';
import { v4 } from 'uuid';
import { rrulestr } from 'rrule';
import {
  Job,
  Queue,
  QueueEvents,
  Repeat,
  getNextMillis,
  Worker,
} from '../src/classes';
import { JobsOptions } from '../src/types';
import { removeAllQueueData } from '../src/utils';
import {
  createRepeatableJobKey,
  extractRepeatableJobChecksumFromRedisKey,
  getRepeatableJobKeyPrefix,
  getRepeatJobIdCheckum,
} from './utils/repeat_utils';

const moment = require('moment');

const ONE_SECOND = 1000;
const ONE_MINUTE = 60 * ONE_SECOND;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

const NoopProc = () => Promise.resolve();

describe('repeat', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
  // TODO: Move timeout to test options: { timeout: 10000 }
  let repeat: Repeat;
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;
  let clock: sinon.SinonFakeTimers;

  let connection;
  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    clock = sinon.useFakeTimers({
      shouldClearNativeTimers: true,
      toFake: ['Date', 'setTimeout', 'clearTimeout'],
    });
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    repeat = new Repeat(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queue.waitUntilReady();
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    clock.restore();
    await queue.close();
    await repeat.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('when exponential backoff is applied', () => {
    it('should retry a job respecting exponential backoff strategy', async () => {
      let delay = 10000;
      const date = new Date('2017-02-07 9:24:00');
      clock.setSystemTime(date);
      const worker = new Worker(
        queueName,
        async () => {
          throw Error('error');
        },
        { autorun: false, connection, prefix },
      );
      const delayStub = sinon.stub(worker, 'delay').callsFake(async () => {
        console.log('delay');
      });
      await worker.waitUntilReady();

      const failing = new Promise<void>(resolve => {
        worker.on('failed', async job => {
          clock.tick(delay + 10);
          delay = delay * 2;

          if (job!.attemptsMade === 10) {
            resolve();
          }
        });
      });

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          attempts: 10,
          backoff: {
            type: 'exponential',
            delay,
          },
        },
      );

      worker.run();

      await failing;

      await worker.close();
      delayStub.restore();
    });
  });

  describe('when endDate is not greater than current timestamp', () => {
    it('throws an error', async () => {
      await expect(
        queue.add(
          'test',
          { foo: 'bar' },
          {
            repeat: {
              endDate: Date.now() - 1000,
              every: 100,
            },
          },
        ),
      ).rejects.toThrow('End date must be greater than current timestamp');
    });
  });

  it('it should stop repeating after endDate', async () => {
    const every = 100;
    const date = new Date('2017-02-07 9:24:00');
    clock.setSystemTime(date);
    const worker = new Worker(
      queueName,
      async () => {
        clock.tick(every);
      },
      { autorun: false, connection, prefix },
    );
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);
    await worker.waitUntilReady();

    let processed = 0;
    const completing = new Promise<void>(resolve => {
      worker.on('completed', async () => {
        processed++;
        if (processed === 10) {
          resolve();
        }
      });
    });

    const job = await queue.add(
      'test',
      { foo: 'bar' },
      {
        repeat: {
          endDate: Date.now() + 1000,
          every: 100,
        },
      },
    );

    expect(job.repeatJobKey).toBeDefined();

    clock.tick(every + 1);

    worker.run();

    await completing;

    const delayed = await queue.getDelayed();

    expect(delayed).toHaveLength(0);
    expect(processed).toBe(10);

    await worker.close();
    delayStub.restore();
  });

  describe('when jobs have the same cron pattern and different name', () => {
    it('should create multiple jobs', async () => {
      const cron = '*/10 * * * * *';

      await Promise.all([
        queue.add('test1', {}, { repeat: { pattern: cron } }),
        queue.add('test2', {}, { repeat: { pattern: cron } }),
        queue.add('test3', {}, { repeat: { pattern: cron } }),
      ]);

      const count = await queue.count();
      expect(count).toEqual(3);
    });
  });

  describe('when jobs have same key and different every pattern', () => {
    it('should create only one repeatable job', async () => {
      await Promise.all([
        queue.add('test1', {}, { repeat: { every: 1000, key: 'test' } }),
        queue.add('test2', {}, { repeat: { every: 2000, key: 'test' } }),
        queue.add('test3', {}, { repeat: { every: 3000, key: 'test' } }),
      ]);

      const repeatableJobs = await queue.getRepeatableJobs();
      expect(repeatableJobs.length).toEqual(1);
    });
  });

  it('should get repeatable jobs with different cron pattern', async () => {
    const crons = [
      '10 * * * * *',
      '2 10 * * * *',
      '1 * * 5 * *',
      '2 * * 4 * *',
    ];

    await Promise.all([
      queue.add('first', {}, { repeat: { pattern: crons[0], endDate: 12345 } }),
      queue.add(
        'second',
        {},
        { repeat: { pattern: crons[1], endDate: 610000 } },
      ),
      queue.add(
        'third',
        {},
        { repeat: { pattern: crons[2], tz: 'Africa/Abidjan' } },
      ),
      queue.add(
        'fourth',
        {},
        { repeat: { pattern: crons[3], tz: 'Africa/Accra' } },
      ),
      queue.add(
        'fifth',
        {},
        { repeat: { every: 5000, tz: 'Europa/Copenhaguen' } },
      ),
    ]);
    const count = await repeat.getRepeatableCount();
    expect(count).toEqual(5);

    let jobs = await repeat.getRepeatableJobs(0, -1, true);
    jobs = await jobs.sort(function (a, b) {
      return crons.indexOf(a.pattern!) - crons.indexOf(b.pattern!);
    });
    expect(jobs).toBeInstanceOf(Array);
    expect(jobs).toHaveLength(5);
    expect(jobs).toContainEqual({
      key: '81e7865a899dddf47c3ad19649304bac',
      name: 'first',
      endDate: 12345,
      tz: null,
      pattern: '10 * * * * *',
      every: null,
      next: 10000,
    });
    expect(jobs).toContainEqual({
      key: '47f7425312b6adf8db58ebd37c7ad8be',
      name: 'second',
      endDate: 610000,
      tz: null,
      pattern: '2 10 * * * *',
      every: null,
      next: 602000,
    });
    expect(jobs).toContainEqual({
      key: 'f1e05411209310794fb4b34ec2a8df6b',
      name: 'fourth',
      endDate: null,
      tz: 'Africa/Accra',
      pattern: '2 * * 4 * *',
      every: null,
      next: 259202000,
    });
    expect(jobs).toContainEqual({
      key: 'd58b8d085ba529d423d59e220a813f82',
      name: 'third',
      endDate: null,
      tz: 'Africa/Abidjan',
      pattern: '1 * * 5 * *',
      every: null,
      next: 345601000,
    });
    expect(jobs).toContainEqual({
      key: 'e891826d68ad4ffbd7243b7f98d88614',
      name: 'fifth',
      endDate: null,
      tz: 'Europa/Copenhaguen',
      pattern: null,
      every: '5000',
      next: 5000,
    });
  });

  it('should repeat every 2 seconds', async () => {
    // TODO: Move timeout to test options: { timeout: 10000 }

    const nextTick = 2 * ONE_SECOND + 100;

    const worker = new Worker(
      queueName,
      async () => {
        clock.tick(nextTick);
      },
      { autorun: false, connection, prefix },
    );
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

    const date = new Date('2017-02-07 9:24:00');
    clock.setSystemTime(date);

    await queue.add(
      'test',
      { foo: 'bar' },
      { repeat: { pattern: '*/2 * * * * *' } },
    );

    clock.tick(nextTick);

    let prev: any;
    let counter = 0;

    const completing = new Promise<void>(resolve => {
      worker.on('completed', async job => {
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

    worker.run();

    await completing;
    await worker.close();
    delayStub.restore();
  });

  describe('when using legacy key', () => {
    it('should repeat every 2 seconds', async () => {
      // TODO: Move timeout to test options: { timeout: 10000 }

      const nextTick = 2 * ONE_SECOND + 100;

      const worker = new Worker(
        queueName,
        async () => {
          clock.tick(nextTick);
        },
        { autorun: false, connection, prefix },
      );
      const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

      const date = new Date('2017-02-07 9:24:00');
      clock.setSystemTime(date);

      await queue.add(
        'test',
        { foo: 'bar' },
        { repeat: { pattern: '*/2 * * * * *', key: 'test::::*/2 * * * * *' } },
      );

      clock.tick(nextTick);

      let prev: any;
      let counter = 0;

      const completing = new Promise<void>((resolve, rejects) => {
        worker.on('completed', async job => {
          try {
            if (prev) {
              expect(prev.timestamp).to.be.lt(job.timestamp);
              expect(job.timestamp - prev.timestamp).to.be.gte(2000);
            }
            prev = job;
            counter++;
            if (counter == 5) {
              resolve();
            }
          } catch (error) {
            rejects(error);
          }
        });
      });

      worker.run();

      await completing;
      await worker.close();
      delayStub.restore();
    });
  });

  it('should repeat every 2 seconds with startDate in future', async () => {
    // TODO: Move timeout to test options: { timeout: 10000 }

    const date = new Date('2017-02-07 9:24:00');
    clock.setSystemTime(date);
    const nextTick = 2 * ONE_SECOND + 500;
    const delay = 5 * ONE_SECOND + 500;

    const worker = new Worker(
      queueName,
      async () => {
        clock.tick(nextTick);
      },
      { autorun: false, connection, prefix },
    );
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

    await queue.add(
      'test',
      { foo: 'bar' },
      {
        repeat: {
          pattern: '*/2 * * * * *',
          startDate: new Date('2017-02-07 9:24:05'),
        },
      },
    );

    clock.tick(nextTick + delay);

    let prev: Job;
    let counter = 0;

    const completing = new Promise<void>(resolve => {
      worker.on('completed', async job => {
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

    worker.run();

    await completing;

    await worker.close();
    delayStub.restore();
  });

  it('should repeat every 2 seconds with startDate in past', async () => {
    // TODO: Move timeout to test options: { timeout: 10000 }

    const date = new Date('2017-02-07 9:24:00');
    clock.setSystemTime(date);
    const nextTick = 2 * ONE_SECOND + 500;
    const delay = 5 * ONE_SECOND + 500;

    const worker = new Worker(
      queueName,
      async () => {
        clock.tick(nextTick);
      },
      { autorun: false, connection, prefix },
    );
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

    await queue.add(
      'repeat',
      { foo: 'bar' },
      {
        repeat: {
          pattern: '*/2 * * * * *',
          startDate: new Date('2017-02-07 9:22:00'),
        },
      },
    );

    clock.tick(nextTick + delay);

    let prev: Job;
    let counter = 0;

    const completing = new Promise<void>(resolve => {
      worker.on('completed', async job => {
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

    worker.run();

    await completing;
    await worker.close();
    delayStub.restore();
  });

  describe('when using removeOnComplete', () => {
    it('should remove repeated job', async () => {
      // TODO: Move timeout to test options: { timeout: 10000 }
      const queueName2 = `test-${v4()}`;
      const queue2 = new Queue(queueName2, {
        connection,
        prefix,
        defaultJobOptions: {
          removeOnComplete: true,
        },
      });

      const date = new Date('2017-02-07 9:24:00');
      clock.setSystemTime(date);
      const nextTick = 2 * ONE_SECOND + 500;
      const delay = 5 * ONE_SECOND + 500;

      const worker = new Worker(
        queueName,
        async () => {
          clock.tick(nextTick);
        },
        { autorun: false, connection, prefix },
      );
      const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          repeat: {
            pattern: '*/2 * * * * *',
            startDate: new Date('2017-02-07 9:24:05'),
          },
        },
      );

      clock.tick(nextTick + delay);

      let prev: Job;
      let counter = 0;

      const completing = new Promise<void>(resolve => {
        worker.on('completed', async job => {
          if (prev) {
            expect(prev.timestamp).to.be.lt(job.timestamp);
            expect(job.timestamp - prev.timestamp).to.be.gte(2000);
          }
          prev = job;
          counter++;
          if (counter == 5) {
            const counts = await queue2.getJobCounts('completed');
            expect(counts.completed).toBe(0);
            resolve();
          }
        });
      });

      worker.run();

      await completing;

      await queue2.close();
      await worker.close();
      await removeAllQueueData(new IORedis(redisHost), queueName2);
      delayStub.restore();
    });
  });

  describe('when custom cron strategy is provided', () => {
    it('should repeat every 2 seconds', async () => {
      // TODO: Move timeout to test options: { timeout: 15000 }
      const settings = {
        repeatStrategy: (millis, opts) => {
          const currentDate =
            opts.startDate && new Date(opts.startDate) > new Date(millis)
              ? new Date(opts.startDate)
              : new Date(millis);
          const rrule = rrulestr(opts.pattern);
          if (rrule.origOptions.count && !rrule.origOptions.dtstart) {
            throw new Error('DTSTART must be defined to use COUNT with rrule');
          }

          const next_occurrence = rrule.after(currentDate, false);
          return next_occurrence?.getTime();
        },
      };
      const currentQueue = new Queue(queueName, {
        connection,
        prefix,
        settings,
      });

      const nextTick = 2 * ONE_SECOND + 100;

      const worker = new Worker(
        queueName,
        async () => {
          clock.tick(nextTick);
        },
        { connection, prefix, settings },
      );
      const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

      const date = new Date('2017-02-07 9:24:00');
      clock.setSystemTime(date);

      await currentQueue.add(
        'test',
        { foo: 'bar' },
        {
          repeat: {
            pattern: 'RRULE:FREQ=SECONDLY;INTERVAL=2;WKST=MO',
          },
        },
      );

      clock.tick(nextTick);

      let prev: any;
      let counter = 0;

      const completing = new Promise<void>(resolve => {
        worker.on('completed', async job => {
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

      await completing;
      await currentQueue.close();
      await worker.close();
      delayStub.restore();
    });

    describe('when differentiating strategy by job name', () => {
      it('should repeat every 2 seconds', async () => {
        // TODO: Move timeout to test options: { timeout: 10000 }
        const settings = {
          repeatStrategy: (millis, opts, name) => {
            if (name === 'rrule') {
              const currentDate =
                opts.startDate && new Date(opts.startDate) > new Date(millis)
                  ? new Date(opts.startDate)
                  : new Date(millis);
              const rrule = rrulestr(opts.pattern);
              if (rrule.origOptions.count && !rrule.origOptions.dtstart) {
                throw new Error(
                  'DTSTART must be defined to use COUNT with rrule',
                );
              }

              const next_occurrence = rrule.after(currentDate, false);
              return next_occurrence?.getTime();
            } else {
              return getNextMillis(millis, opts);
            }
          },
        };
        const currentQueue = new Queue(queueName, {
          connection,
          prefix,
          settings,
        });

        const nextTick = 2 * ONE_SECOND + 100;

        const worker = new Worker(
          queueName,
          async job => {
            clock.tick(nextTick);

            if (job.opts.repeat!.count == 5) {
              const removed = await queue.removeRepeatable('rrule', repeat);
              expect(removed).toBe(true);
            }
          },
          { connection, prefix, settings },
        );
        const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

        const date = new Date('2017-02-07 9:24:00');
        clock.setSystemTime(date);

        const repeat = {
          pattern: 'RRULE:FREQ=SECONDLY;INTERVAL=2;WKST=MO',
        };
        await currentQueue.add(
          'rrule',
          { foo: 'bar' },
          {
            repeat,
          },
        );

        clock.tick(nextTick);

        let prev: any;
        let counter = 0;

        const completing = new Promise<void>((resolve, reject) => {
          worker.on('completed', async job => {
            try {
              if (prev) {
                expect(prev.timestamp).to.be.lt(job.timestamp);
                expect(job.timestamp - prev.timestamp).to.be.gte(2000);
              }
              prev = job;
              counter++;
              if (counter == 5) {
                resolve();
              }
            } catch (error) {
              reject(error);
            }
          });
        });

        await completing;

        let prev2: any;
        let counter2 = 0;

        const completing2 = new Promise<void>((resolve, reject) => {
          worker.on('completed', async job => {
            try {
              if (prev2) {
                expect(prev2.timestamp).to.be.lt(job.timestamp);
                expect(job.timestamp - prev2.timestamp).to.be.gte(2000);
              }
              prev2 = job;
              counter2++;
              if (counter2 == 5) {
                resolve();
              }
            } catch (error) {
              reject(error);
            }
          });
        });

        await queue.add(
          'test',
          { foo: 'bar' },
          {
            repeat: {
              pattern: '*/2 * * * * *',
              startDate: new Date('2017-02-07 9:24:05'),
            },
          },
        );

        clock.tick(nextTick);

        await completing2;

        await currentQueue.close();
        await worker.close();
        delayStub.restore();
      });
    });
  });

  it('should have repeatable job key with sha256 hashing when sha256 hash algorithm is provided', async () => {
    // TODO: Move timeout to test options: { timeout: 15000 }
    const settings = {
      repeatKeyHashAlgorithm: 'sha256',
    };
    const currentQueue = new Queue(queueName, { connection, prefix, settings });

    const worker = new Worker(queueName, null, {
      connection,
      prefix,
      settings,
    });
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);
    await worker.waitUntilReady();
    const jobName = 'jobName';
    const jobId = 'jobId';
    const endDate = '';
    const tz = '';
    const every = 50;
    const suffix = every;
    await currentQueue.add(
      jobName,
      { foo: 'bar' },
      {
        repeat: {
          jobId,
          every,
        },
      },
    );

    const keyPrefix = getRepeatableJobKeyPrefix(prefix, queueName);
    const client = await worker.client;

    const jobsRedisKeys = await client.keys(`${keyPrefix}*`);
    expect(jobsRedisKeys.length).toBe(2);

    const actualHashedRepeatableJobKey =
      extractRepeatableJobChecksumFromRedisKey(
        jobsRedisKeys[0].length > jobsRedisKeys[1].length
          ? jobsRedisKeys[1]
          : jobsRedisKeys[0],
      );
    const expectedRawKey = createRepeatableJobKey(
      jobName,
      jobId,
      endDate,
      tz,
      suffix,
    );
    const expectedRepeatJobIdCheckum = getRepeatJobIdCheckum(
      expectedRawKey,
      settings.repeatKeyHashAlgorithm,
    );

    expect(actualHashedRepeatableJobKey).toBe(expectedRepeatJobIdCheckum);

    await currentQueue.close();
    await worker.close();
    delayStub.restore();
  });

  it('should repeat every 2 seconds and start immediately', async () => {
    const date = new Date('2017-02-07 9:24:00');
    clock.setSystemTime(date);
    const nextTick = 2 * ONE_SECOND;

    const worker = new Worker(
      queueName,
      async () => {
        clock.tick(nextTick);
      },
      { connection, prefix },
    );
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

    let prev: Job;
    let counter = 0;

    const completing = new Promise<void>(resolve => {
      worker.on('completed', async job => {
        if (prev && counter === 1) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.processedOn! - prev.timestamp).to.be.gte(100);
        } else if (prev) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.processedOn! - prev.timestamp).to.be.gte(2000);
        }
        prev = job;
        counter++;
        if (counter === 5) {
          resolve();
        }
      });
    });

    await queue.add(
      'repeat',
      { foo: 'bar' },
      {
        repeat: {
          every: 2000,
          immediately: true,
        },
      },
    );

    clock.tick(100);

    await completing;
    await worker.close();
    delayStub.restore();
  });

  it('should repeat once a day for 5 days and start immediately using endDate', async () => {
    // TODO: Move timeout to test options: { timeout: 8000 }

    const date = new Date('2017-05-05 01:01:00');
    clock.setSystemTime(date);

    const nextTick = ONE_DAY + 10 * ONE_SECOND;
    const delay = 5 * ONE_SECOND + 500;

    const worker = new Worker(
      queueName,
      async () => {
        clock.tick(nextTick);
      },
      {
        autorun: false,
        connection,
        prefix,
        skipStalledCheck: true,
        skipLockRenewal: true,
      },
    );
    const delayStub = sinon.stub(worker, 'delay').callsFake(async () => {
      console.log('delay');
    });

    let prev: Job;
    let counter = 0;
    const completing = new Promise<void>((resolve, reject) => {
      worker.on('completed', async job => {
        if (counter === 1) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.processedOn! - prev.timestamp).to.be.gte(delay);
        } else if (prev) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.processedOn! - prev.timestamp).to.be.gte(ONE_DAY);
        }
        prev = job;

        counter++;
        if (counter == 5) {
          resolve();
        }
      });
    });

    await queue.add(
      'repeat',
      { foo: 'bar' },
      {
        repeat: {
          pattern: '0 1 * * *',
          immediately: true,
          endDate: new Date('2017-05-10 13:13:00'),
        },
      },
    );
    clock.tick(delay);

    worker.run();

    await completing;
    await worker.close();
    delayStub.restore();
  });

  it('should repeat once a day for 5 days and start immediately', async () => {
    // TODO: Move timeout to test options: { timeout: 8000 }

    const date = new Date('2017-05-05 01:01:00');
    clock.setSystemTime(date);

    const nextTick = ONE_DAY + 10 * ONE_SECOND;
    const delay = 5 * ONE_SECOND + 500;

    let counter = 0;
    const worker = new Worker(
      queueName,
      async () => {
        if (counter === 0) {
          clock.tick(6 * ONE_HOUR);
        } else {
          clock.tick(nextTick);
        }
      },
      {
        autorun: false,
        connection,
        prefix,
        skipStalledCheck: true,
        skipLockRenewal: true,
      },
    );
    const delayStub = sinon.stub(worker, 'delay').callsFake(async () => {
      console.log('delay');
    });

    let prev: Job;
    const completing = new Promise<void>(resolve => {
      worker.on('completed', async job => {
        if (counter === 1) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.processedOn! - prev.timestamp).to.be.gte(delay);
        } else if (prev) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.processedOn! - prev.timestamp).to.be.gte(ONE_DAY);
        }
        prev = job;

        counter++;
        if (counter == 5) {
          resolve();
        }
      });
    });

    await queue.add(
      'repeat',
      { foo: 'bar' },
      {
        repeat: {
          pattern: '0 0 7 * * *',
          immediately: true,
        },
      },
    );
    clock.tick(delay);

    worker.run();

    await completing;
    await worker.close();
    delayStub.restore();
  });

  it('should repeat once a day for 5 days', async () => {
    // TODO: Move timeout to test options: { timeout: 8000 }

    const date = new Date('2017-05-05 13:12:00');
    clock.setSystemTime(date);

    const nextTick = ONE_DAY + 10 * ONE_SECOND;
    const delay = 5 * ONE_SECOND + 500;

    const worker = new Worker(
      queueName,
      async () => {
        clock.tick(nextTick);
      },
      {
        autorun: false,
        connection,
        prefix,
        skipStalledCheck: true,
        skipLockRenewal: true,
      },
    );
    const delayStub = sinon.stub(worker, 'delay').callsFake(async () => {
      console.log('delay');
    });

    let prev: Job;
    let counter = 0;
    const completing = new Promise<void>(resolve => {
      worker.on('completed', async job => {
        try {
          if (prev) {
            expect(prev.timestamp).to.be.lt(job.timestamp);
            expect(job.processedOn! - prev.timestamp).to.be.gte(ONE_DAY);
          }
          prev = job;

          counter++;
          if (counter == 5) {
            resolve();
          }
        } catch (error) {
          console.log(error);
        }
      });
    });

    await queue.add(
      'repeat',
      { foo: 'bar' },
      {
        repeat: {
          pattern: '0 1 * * *',
          endDate: new Date('2017-05-10 01:00:00'),
        },
      },
    );

    clock.tick(nextTick + delay);

    worker.run();

    await completing;
    await worker.close();
    delayStub.restore();
  });

  describe('when utc option is provided', () => {
    it('repeats once a day for 5 days', async () => {
      // TODO: Move timeout to test options: { timeout: 8000 }

      const date = new Date('2017-05-05 13:12:00');
      clock.setSystemTime(date);

      const nextTick = ONE_DAY + 10 * ONE_SECOND;
      const delay = 5 * ONE_SECOND + 500;

      const worker = new Worker(
        queueName,
        async () => {
          clock.tick(nextTick);
        },
        { autorun: false, connection, prefix },
      );
      const delayStub = sinon.stub(worker, 'delay').callsFake(async () => {
        console.log('delay');
      });

      let prev: Job;
      let counter = 0;
      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async job => {
          try {
            if (prev) {
              expect(prev.timestamp).to.be.lt(job.timestamp);
              expect(job.processedOn! - prev.timestamp).to.be.gte(ONE_DAY);
            }
            prev = job;

            counter++;
            if (counter == 5) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add(
        'repeat',
        { foo: 'bar' },
        {
          repeat: {
            pattern: '0 1 * * *',
            endDate: new Date('2017-05-10 13:13:00'),
            tz: 'Europe/Athens',
            utc: true,
          },
        },
      );
      clock.tick(nextTick + delay);

      worker.run();

      await completing;
      await worker.close();
      delayStub.restore();
    });
  });

  it('should repeat 7:th day every month at 9:25', async () => {
    // TODO: Move timeout to test options: { timeout: 12000 }

    const date = new Date('2017-02-02 7:21:42');
    clock.setSystemTime(date);

    const nextTick = () => {
      const now = moment();
      const nextMonth = moment().add(1, 'months');
      clock.tick(nextMonth - now);
    };

    const worker = new Worker(
      queueName,
      async () => {
        nextTick();
      },
      { autorun: false, connection, prefix },
    );
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

    let counter = 25;
    let prev: Job;
    const completing = new Promise<void>((resolve, reject) => {
      worker.on('completed', async job => {
        try {
          if (prev) {
            expect(prev.timestamp).to.be.lt(job.timestamp);
            const diff = moment(job.processedOn!).diff(
              moment(prev.timestamp),
              'months',
              true,
            );
            expect(diff).to.be.gte(1);
          }
          prev = job;

          counter--;
          if (counter == 0) {
            resolve();
          }
        } catch (error) {
          console.log(error);
          reject(error);
        }
      });
    });

    worker.run();

    await queue.add(
      'repeat',
      { foo: 'bar' },
      { repeat: { pattern: '25 9 7 * *' } },
    );
    nextTick();

    await completing;
    await worker.close();
    delayStub.restore();
  });

  describe('when 2 jobs with the same options are added', () => {
    it('creates only one job', async () => {
      const options = {
        repeat: {
          pattern: '0 1 * * *',
        },
      };

      const p1 = queue.add('test', { foo: 'bar' }, options);
      const p2 = queue.add('test', { foo: 'bar' }, options);

      const jobs = await Promise.all([p1, p2]);
      const configs = await repeat.getRepeatableJobs(0, -1, true);

      const count = await queue.count();

      expect(count).toBe(1);
      expect(configs).toHaveLength(1);
      expect(jobs.length).toEqual(2);
      expect(jobs[0].id).toEqual(jobs[1].id);
    });
  });

  describe('when repeatable job is promoted', () => {
    it('keeps one repeatable and one delayed after being processed', async () => {
      const options = {
        repeat: {
          pattern: '0 * 1 * *',
        },
      };

      const worker = new Worker(queueName, NoopProc, {
        connection,
        prefix,
      });

      const completing = new Promise<void>(resolve => {
        worker.on('completed', () => {
          resolve();
        });
      });

      const repeatableJob = await queue.add('test', { foo: 'bar' }, options);
      const delayedCount = await queue.getDelayedCount();
      expect(delayedCount).toBe(1);

      await repeatableJob.promote();
      await completing;

      const delayedCount2 = await queue.getDelayedCount();
      expect(delayedCount2).toBe(1);

      const configs = await repeat.getRepeatableJobs(0, -1, true);

      expect(delayedCount).toBe(1);

      const count = await queue.count();

      expect(count).toBe(1);
      expect(configs).toHaveLength(1);
      await worker.close();
    });
  });

  it('should allow removing a named repeatable job', async () => {
    const numJobs = 3;
    const date = new Date('2017-02-07 9:24:00');
    let prev: Job;
    let counter = 0;

    clock.setSystemTime(date);

    const nextTick = ONE_SECOND + 1;
    const repeat = { pattern: '*/1 * * * * *' };
    let processor;

    const processing = new Promise<void>((resolve, reject) => {
      processor = async () => {
        counter++;
        if (counter == numJobs) {
          const removed = await queue.removeRepeatable('remove', repeat);
          expect(removed).toBe(true);
          clock.tick(nextTick);
          const delayed = await queue.getDelayed();
          expect(delayed).toHaveLength(0);
          resolve();
        } else if (counter > numJobs) {
          reject(Error(`should not repeat more than ${numJobs} times`));
        }
      };
    });

    const worker = new Worker(queueName, processor, { connection, prefix });
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

    await queue.add('remove', { foo: 'bar' }, { repeat });
    clock.tick(nextTick);

    worker.on('completed', job => {
      clock.tick(nextTick);
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(ONE_SECOND);
      }
      prev = job;
    });

    await processing;
    await worker.close();
    delayStub.restore();
  });

  it('should be able to remove repeatable jobs by key', async () => {
    const client = await queue.client;
    const repeat = { pattern: '*/2 * * * * *' };

    const createdJob = await queue.add('remove', { foo: 'bar' }, { repeat });
    const delayedCount1 = await queue.getJobCountByTypes('delayed');
    expect(delayedCount1).toBe(1);
    const job = await queue.getJob(createdJob.id!);
    const repeatableJobs = await queue.getRepeatableJobs();
    expect(repeatableJobs).toHaveLength(1);
    const existBeforeRemoval = await client.exists(
      `${prefix}:${queue.name}:repeat:${createdJob.repeatJobKey!}`,
    );
    expect(existBeforeRemoval).toBe(1);
    const removed = await queue.removeRepeatableByKey(createdJob.repeatJobKey!);
    const delayedCount = await queue.getJobCountByTypes('delayed');
    expect(delayedCount).toBe(0);
    const existAfterRemoval = await client.exists(
      `${prefix}:${queue.name}:repeat:${createdJob.repeatJobKey!}`,
    );
    expect(existAfterRemoval).toBe(0);
    expect(job!.repeatJobKey).toBeDefined();
    expect(removed).toBe(true);
    const repeatableJobsAfterRemove = await queue.getRepeatableJobs();
    expect(repeatableJobsAfterRemove).toHaveLength(0);
  });

  describe('when legacy repeatable format is present', () => {
    it('should be able to remove legacy repeatable jobs', async () => {
      const client = await queue.client;
      await client.hmset(
        `${prefix}:${queue.name}:repeat:839d4be40c8b2f30fca6f860d0cf76f7:1735711200000`,
        'priority',
        0,
        'delay',
        14524061394,
        'data',
        '{}',
        'timestamp',
        1721187138606,
        'rjk',
        'remove::::* 1 * 1 *',
        'name',
        'remove',
      );
      await client.zadd(
        `${prefix}:${queue.name}:repeat`,
        1735711200000,
        'remove::::* 1 * 1 *',
      );
      await client.zadd(
        `${prefix}:${queue.name}:delayed`,
        1735711200000,
        'repeat:839d4be40c8b2f30fca6f860d0cf76f7:1735711200000',
      );

      const repeat = { pattern: '* 1 * 1 *' };

      const repeatableJobs = await queue.getRepeatableJobs();
      expect(repeatableJobs).toHaveLength(1);
      const removed = await queue.removeRepeatable('remove', repeat);

      const delayedCount = await queue.getJobCountByTypes('delayed');
      expect(delayedCount).toBe(0);
      expect(removed).toBe(true);
      const repeatableJobsAfterRemove = await queue.getRepeatableJobs();
      expect(repeatableJobsAfterRemove).toHaveLength(0);
    });

    it('should be able to remove legacy repeatable jobs by key', async () => {
      const client = await queue.client;
      await client.hmset(
        `${prefix}:${queue.name}:repeat:839d4be40c8b2f30fca6f860d0cf76f7:1735711200000`,
        'priority',
        0,
        'delay',
        14524061394,
        'data',
        '{}',
        'timestamp',
        1721187138606,
        'rjk',
        'remove::::* 1 * 1 *',
        'name',
        'remove',
      );
      await client.zadd(
        `${prefix}:${queue.name}:repeat`,
        1735711200000,
        'remove::::* 1 * 1 *',
      );
      await client.zadd(
        `${prefix}:${queue.name}:delayed`,
        1735711200000,
        'repeat:839d4be40c8b2f30fca6f860d0cf76f7:1735711200000',
      );

      const repeatableJobs = await queue.getRepeatableJobs();
      expect(repeatableJobs).toHaveLength(1);
      const removed = await queue.removeRepeatableByKey('remove::::* 1 * 1 *');

      const delayedCount = await queue.getJobCountByTypes('delayed');
      expect(delayedCount).toBe(0);
      expect(removed).toBe(true);
      const repeatableJobsAfterRemove = await queue.getRepeatableJobs();
      expect(repeatableJobsAfterRemove).toHaveLength(0);
    });

    describe('when re-adding repeatable job now with new format', () => {
      it('should keep legacy repeatable job and be able to remove it', async () => {
        clock.setSystemTime(1721187138606);
        const client = await queue.client;
        await client.hmset(
          `${prefix}:${queue.name}:repeat:839d4be40c8b2f30fca6f860d0cf76f7:1735711200000`,
          'priority',
          0,
          'delay',
          14524061394,
          'data',
          '{}',
          'timestamp',
          1721187138606,
          'rjk',
          'remove::::* 1 * 1 *',
          'name',
          'remove',
        );
        await client.zadd(
          `${prefix}:${queue.name}:repeat`,
          1735711200000,
          'remove::::* 1 * 1 *',
        );
        await client.zadd(
          `${prefix}:${queue.name}:delayed`,
          1735711200000,
          'repeat:839d4be40c8b2f30fca6f860d0cf76f7:1735711200000',
        );

        const repeat = { pattern: '* 1 * 1 *' };

        const repeatableJobs = await queue.getRepeatableJobs();
        expect(repeatableJobs).toHaveLength(1);
        expect(repeatableJobs[0].key).toBe('remove::::* 1 * 1 *');
        const removed = await queue.removeRepeatable('remove', repeat);

        const delayedCount = await queue.getJobCountByTypes('delayed');
        expect(delayedCount).toBe(0);
        expect(removed).toBe(true);
        const repeatableJobsAfterRemove = await queue.getRepeatableJobs();
        expect(repeatableJobsAfterRemove).toHaveLength(0);
      });

      it('should keep legacy repeatable job and delayed referece', async () => {
        clock.setSystemTime(1721187138606);

        const client = await queue.client;
        await client.zadd(
          `${prefix}:${queue.name}:repeat`,
          1735693200000,
          'remove::::* 1 * 1 *',
        );

        await queue.add('remove', {}, { repeat: { pattern: '* 1 * 1 *' } });
        const repeatableJobs = await queue.getRepeatableJobs();
        expect(repeatableJobs).toHaveLength(1);
        expect(repeatableJobs[0].key).toBe('remove::::* 1 * 1 *');

        const delayedCount = await queue.getJobCountByTypes('delayed');
        expect(delayedCount).toBe(1);
      });
    });
  });

  describe('when repeatable job does not exist', () => {
    it('returns false', async () => {
      const repeat = { pattern: '*/2 * * * * *' };

      await queue.add('remove', { foo: 'bar' }, { repeat });
      const repeatableJobs = await queue.getRepeatableJobs();
      expect(repeatableJobs).toHaveLength(1);
      const removed = await queue.removeRepeatableByKey(repeatableJobs[0].key);
      expect(removed).toBe(true);
      const removed2 = await queue.removeRepeatableByKey(repeatableJobs[0].key);
      expect(removed2).toBe(false);
    });
  });

  it('should allow removing a customId repeatable job', async () => {
    const numJobs = 4;
    const date = new Date('2017-02-07 9:24:00');
    let prev: Job;
    let counter = 0;
    let processor;
    const jobId = 'xxxx';

    clock.setSystemTime(date);

    const nextTick = 2 * ONE_SECOND + 10;
    const repeat = { pattern: '*/2 * * * * *' };

    await queue.add('test', { foo: 'bar' }, { repeat, jobId });

    clock.tick(nextTick);

    const processing = new Promise<void>((resolve, reject) => {
      processor = async () => {
        counter++;
        if (counter == numJobs) {
          try {
            await queue.removeRepeatable('test', repeat, jobId);
            clock.tick(nextTick);
            const delayed = await queue.getDelayed();
            expect(delayed).toHaveLength(0);
            resolve();
          } catch (err) {
            reject(err);
          }
        } else if (counter > numJobs) {
          reject(Error(`should not repeat more than ${numJobs} times`));
        }
      };
    });

    const worker = new Worker(queueName, processor, { connection, prefix });
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);
    await worker.waitUntilReady();

    worker.on('completed', job => {
      clock.tick(nextTick);
      if (prev) {
        expect(prev.timestamp).to.be.lt(job.timestamp);
        expect(job.timestamp - prev.timestamp).to.be.gte(2000);
      }
      prev = job;
    });

    await processing;
    await worker.close();
    delayStub.restore();
  });

  describe('when custom key is provided', () => {
    it('should allow removing a repeatable job by custom key', async () => {
      const numJobs = 4;
      const date = new Date('2017-02-07 9:24:00');
      let prev: Job;
      let counter = 0;
      let processor;
      const key = 'xxxx';

      clock.setSystemTime(date);

      const nextTick = 2 * ONE_SECOND + 10;
      const repeat = { pattern: '*/2 * * * * *', key };

      await queue.add('test', { foo: 'bar' }, { repeat });

      clock.tick(nextTick);

      const processing = new Promise<void>((resolve, reject) => {
        processor = async () => {
          counter++;
          if (counter == numJobs) {
            try {
              await queue.removeRepeatable('test', repeat);
              clock.tick(nextTick);
              const delayed = await queue.getDelayed();
              expect(delayed).toHaveLength(0);
              resolve();
            } catch (err) {
              reject(err);
            }
          } else if (counter > numJobs) {
            reject(Error(`should not repeat more than ${numJobs} times`));
          }
        };
      });

      const worker = new Worker(queueName, processor, { connection, prefix });
      const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);
      await worker.waitUntilReady();

      worker.on('completed', job => {
        clock.tick(nextTick);
        if (prev) {
          expect(prev.timestamp).to.be.lt(job.timestamp);
          expect(job.timestamp - prev.timestamp).to.be.gte(2000);
        }
        prev = job;
      });

      await processing;
      await worker.close();
      delayStub.restore();
    });

    it('should keep only one delayed job if adding a new repeatable job with the same key', async () => {
      const date = new Date('2017-02-07 9:24:00');
      const key = 'mykey';

      clock.setSystemTime(date);

      const nextTick = 2 * ONE_SECOND;

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          repeat: {
            every: 10_000,
            key,
          },
        },
      );

      clock.tick(nextTick);

      let jobs = await queue.getRepeatableJobs();
      expect(jobs).toHaveLength(1);

      let delayedJobs = await queue.getDelayed();
      expect(delayedJobs).toHaveLength(1);

      await queue.add(
        'test2',
        { qux: 'baz' },
        {
          repeat: {
            every: 35_160,
            key,
          },
        },
      );

      jobs = await queue.getRepeatableJobs();
      expect(jobs).toHaveLength(1);

      delayedJobs = await queue.getDelayed();
      expect(delayedJobs).toHaveLength(1);
    });

    it('should keep only one delayed job if adding a new repeatable job with the same key', async () => {
      const date = new Date('2017-02-07 9:24:00');
      const key = 'mykey';

      clock.setSystemTime(date);

      const nextTick = 2 * ONE_SECOND;

      await queue.add(
        'test',
        { foo: 'bar' },
        {
          repeat: {
            every: 10_000,
            key,
          },
        },
      );

      clock.tick(nextTick);

      let jobs = await queue.getRepeatableJobs();
      expect(jobs).toHaveLength(1);

      let delayedJobs = await queue.getDelayed();
      expect(delayedJobs).toHaveLength(1);

      await queue.add(
        'test2',
        { qux: 'baz' },
        {
          repeat: {
            every: 35_160,
            key,
          },
        },
      );

      jobs = await queue.getRepeatableJobs();
      expect(jobs).toHaveLength(1);

      delayedJobs = await queue.getDelayed();
      expect(delayedJobs).toHaveLength(1);
    });
  });

  // This test is flaky and too complex we need something simpler that tests the same thing
  it.skip('should not re-add a repeatable job after it has been removed', async function () {
    const repeat = await queue.repeat;

    let worker: Worker;
    const jobId = 'xxxx';
    const date = new Date('2017-02-07 9:24:00');
    const nextTick = 2 * ONE_SECOND + 100;
    const addNextRepeatableJob = repeat.updateRepeatableJob;
    clock.setSystemTime(date);

    const repeatOpts = { pattern: '*/2 * * * * *' };

    const afterRemoved = new Promise<void>(async resolve => {
      worker = new Worker(
        queueName,
        async () => {
          const repeatWorker = await worker.repeat;
          (<unknown>repeatWorker.updateRepeatableJob) = async (
            ...args: [string, unknown, JobsOptions, boolean?]
          ) => {
            // In order to simulate race condition
            // Make removeRepeatables happen any time after a moveToX is called
            await queue.removeRepeatable('test', repeatOpts, jobId);

            // addNextRepeatableJob will now re-add the removed repeatable
            const result = await addNextRepeatableJob.apply(repeat, args);
            resolve();
            return result;
          };
        },
        { connection, prefix },
      );

      worker.on('completed', () => {
        clock.tick(nextTick);
      });
    });

    await queue.add('test', { foo: 'bar' }, { repeat: repeatOpts, jobId });

    clock.tick(nextTick);

    await afterRemoved;

    const jobs = await queue.getRepeatableJobs();
    // Repeatable job was recreated
    expect(jobs.length).toEqual(0);

    await worker!.close();
  });

  it('should allow adding a repeatable job after removing it', async () => {
    const repeat = {
      pattern: '*/5 * * * *',
    };

    const worker = new Worker(queueName, NoopProc, { connection, prefix });
    await worker.waitUntilReady();
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

    await queue.add(
      'myTestJob',
      {
        data: '2',
      },
      {
        repeat,
      },
    );
    let delayed = await queue.getDelayed();
    expect(delayed.length).toEqual(1);

    await new Promise<void>(resolve => {
      queueEvents.on('removed', async ({ jobId, prev }) => {
        expect(jobId).toBe(delayed[0].id);
        expect(prev).toBe('delayed');
        resolve();
      });

      queue.removeRepeatable('myTestJob', repeat);
    });

    delayed = await queue.getDelayed();
    expect(delayed.length).toEqual(0);

    await queue.add('myTestJob', { data: '2' }, { repeat: repeat });

    delayed = await queue.getDelayed();
    expect(delayed.length).toEqual(1);

    // We need to force close in this case, as closing is too slow in Dragonfly.
    await worker.close(true);
    delayStub.restore();
  }); // TODO: Add { timeout: 8000 } to the it() options

  it('should not allow to remove a delayed job if it belongs to a repeatable job', async () => {
    const repeat = {
      every: 1000,
    };

    await queue.add('myTestJob', { data: 'foo' }, { repeat });

    // Get delayed jobs
    const delayed = await queue.getDelayed();
    expect(delayed.length).toEqual(1);

    // Try to remove the delayed job
    const job = delayed[0];
    await expect(job.remove()).rejects.toThrow(
      `Job ${job.id} belongs to a job scheduler and cannot be removed directly. remove`,
    );
  });

  it('should not repeat more than 5 times', async () => {
    const date = new Date('2017-02-07 9:24:00');
    clock.setSystemTime(date);
    const nextTick = ONE_SECOND + 500;

    const worker = new Worker(queueName, NoopProc, { connection, prefix });
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

    await queue.add(
      'repeat',
      { foo: 'bar' },
      { repeat: { limit: 5, pattern: '*/1 * * * * *' } },
    );
    clock.tick(nextTick);

    let counter = 0;

    const completing = new Promise<void>((resolve, reject) => {
      worker.on('completed', () => {
        clock.tick(nextTick);
        counter++;
        if (counter == 5) {
          resolve();
        } else if (counter > 5) {
          reject(Error('should not repeat more than 5 times'));
        }
      });
    });

    await completing;
    await worker.close();
    delayStub.restore();
  });

  it('should processes delayed jobs by priority', async () => {
    let currentPriority = 1;
    const nextTick = 1000;

    let processor;
    clock.setSystemTime(new Date('2017-02-02 7:21:42'));

    const processing = new Promise<void>((resolve, reject) => {
      processor = async (job: Job) => {
        try {
          expect(job.id).toBeTruthy();
          expect(job.data.p).toEqual(currentPriority++);
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

    clock.tick(nextTick * 3 + 100);

    const worker = new Worker(queueName, processor, { connection, prefix });
    await worker.waitUntilReady();

    await processing;

    await worker.close();
  });

  it('should use ".every" as a valid interval', async function () {
    const interval = ONE_SECOND * 2;
    const date = new Date('2017-02-07 9:24:00');

    clock.setSystemTime(date);

    const nextTick = ONE_SECOND * 2 + 500;

    await queue.add('repeat m', { type: 'm' }, { repeat: { every: interval } });
    await queue.add('repeat s', { type: 's' }, { repeat: { every: interval } });
    clock.tick(nextTick);

    const worker = new Worker(queueName, NoopProc, {
      connection,
      prefix,
    });
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);
    await worker.waitUntilReady();

    let prevType: string;
    let counter = 0;

    const completing = new Promise<void>(resolve => {
      worker.on('completed', job => {
        clock.tick(nextTick);
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

    await completing;
    await worker.close();
    delayStub.restore();
  });

  it('should throw an error when using .pattern and .every simultaneously', async () => {
    await expect(
      queue.add(
        'repeat',
        { type: 'm' },
        { repeat: { every: 5000, pattern: '* /1 * * * * *' } },
      ),
    ).rejects.toThrow(
      'Both .pattern and .every options are defined for this repeatable job',
    );
  });

  it('should emit a waiting event when adding a repeatable job to the waiting list', async () => {
    const date = new Date('2017-02-07 9:24:00');
    clock.setSystemTime(date);
    const nextTick = 1 * ONE_SECOND + 500;

    const worker = new Worker(queueName, async job => {}, {
      connection,
      prefix,
    });
    const delayStub = sinon.stub(worker, 'delay').callsFake(NoopProc);

    const waiting = new Promise<void>((resolve, reject) => {
      queueEvents.on('waiting', function ({ jobId }) {
        try {
          expect(jobId).toBe(
            `repeat:16db7a9b166154f5c636abf3c8fe3364:${date.getTime() + 1 * ONE_SECOND}`,
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
      { repeat: { pattern: '*/1 * * * * *' } },
    );
    clock.tick(nextTick);

    await waiting;
    await worker.close();
    delayStub.restore();
  });

  it('should have the right count value', async () => {
    await queue.add('test', { foo: 'bar' }, { repeat: { every: 1000 } });
    clock.tick(ONE_SECOND + 100);

    let processor;
    const processing = new Promise<void>((resolve, reject) => {
      processor = async (job: Job) => {
        if (job.opts.repeat!.count === 1) {
          resolve();
        } else {
          reject(new Error('repeatable job got the wrong repeat count'));
        }
      };
    });

    const worker = new Worker(queueName, processor, { connection, prefix });

    await processing;
    await worker.close();
  });
});
