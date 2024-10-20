import { default as IORedis } from 'ioredis';
import { v4 } from 'uuid';
import { expect } from 'chai';
import { after } from 'lodash';
import { beforeEach, describe, it, before, after as afterAll } from 'mocha';
import {
  FlowProducer,
  Queue,
  QueueEvents,
  QueueEventsListener,
  QueueEventsProducer,
  Worker,
} from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('events', function () {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  this.timeout(8000);
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
    await queue.waitUntilReady();
    await queueEvents.waitUntilReady();
  });

  afterEach(async function () {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('when autorun option is provided as false', function () {
    it('emits waiting when a job has been added', async () => {
      const queueName2 = `test-${v4()}`;
      const queue2 = new Queue(queueName2, { connection, prefix });
      const queueEvents2 = new QueueEvents(queueName2, {
        autorun: false,
        connection,
        prefix,
      });
      await queueEvents2.waitUntilReady();

      const waiting = new Promise(resolve => {
        queue2.on('waiting', resolve);
      });

      const running = queueEvents2.run();

      await queue2.add('test', { foo: 'bar' });

      await waiting;

      await queue2.close();
      await queueEvents2.close();
      await expect(running).to.have.been.fulfilled;
      await removeAllQueueData(new IORedis(redisHost), queueName2);
    });

    describe('when run method is called when queueEvent is running', function () {
      it('throws error', async () => {
        const queueName2 = `test-${v4()}`;
        const queue2 = new Queue(queueName2, { connection, prefix });
        const queueEvents2 = new QueueEvents(queueName2, {
          autorun: false,
          connection,
          prefix,
        });
        await queueEvents2.waitUntilReady();

        const running = queueEvents2.run();

        await queue2.add('test', { foo: 'bar' });

        await expect(queueEvents2.run()).to.be.rejectedWith(
          'Queue Events is already running.',
        );

        await queue2.close();
        await queueEvents2.close();
        await expect(running).to.have.been.fulfilled;
        await removeAllQueueData(new IORedis(redisHost), queueName2);
      });
    });
  });

  it('should emit waiting when a job has been added', async function () {
    const waiting = new Promise<void>(resolve => {
      queue.on('waiting', job => {
        expect(job.id).to.be.string;
        resolve();
      });
    });

    await queue.add('test', { foo: 'bar' });

    await waiting;
  });

  it('should emit global waiting event when a job has been added', async function () {
    await delay(100);
    const waiting = new Promise(resolve => {
      queueEvents.on('waiting', resolve);

      queue.add('test', { foo: 'bar' });
    });

    await waiting;
  });

  describe('when jobs are cleaned', function () {
    it('emits cleaned global event', async function () {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(10);
        },
        {
          connection,
          prefix,
          autorun: false,
        },
      );
      const numJobs = 50;

      worker.on(
        'completed',
        after(numJobs, async function () {
          await delay(10);
          await queue.clean(0, 0, 'completed');
        }),
      );

      const cleaned = new Promise<void>((resolve, reject) => {
        queueEvents.once('cleaned', async ({ count }) => {
          try {
            expect(count).to.be.eql('50');
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });

      const jobs = Array.from(Array(numJobs).keys()).map(() => ({
        name: 'test',
        data: { foo: 'bar' },
      }));
      await queue.addBulk(jobs);

      worker.run();

      await cleaned;

      const actualCount = await queue.count();
      expect(actualCount).to.be.equal(0);

      await worker.close();
    });
  });

  it('emits drained global event when all jobs have been processed', async function () {
    const worker = new Worker(queueName, async () => {}, {
      drainDelay: 1,
      connection,
      prefix,
    });

    const drained = new Promise<void>(resolve => {
      queueEvents.once('drained', id => {
        expect(id).to.be.string;
        resolve();
      });
    });

    await queue.addBulk([
      { name: 'test', data: { foo: 'bar' } },
      { name: 'test', data: { foo: 'baz' } },
    ]);

    await drained;

    const jobs = await queue.getJobCountByTypes('completed');
    expect(jobs).to.be.gte(1);
    expect(jobs).to.be.lte(2);

    await worker.close();
  });

  describe('when concurrency is greater than 1', function () {
    it('emits drained global event when all jobs have been processed', async function () {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(500);
        },
        {
          concurrency: 4,
          drainDelay: 500,
          connection,
          prefix,
        },
      );

      const drained = new Promise<void>(resolve => {
        queueEvents.once('drained', id => {
          expect(id).to.be.string;
          resolve();
        });
      });

      await queue.addBulk([
        { name: 'test', data: { foo: 'bar' } },
        { name: 'test', data: { foo: 'baz' } },
        { name: 'test', data: { foo: 'bax' } },
        { name: 'test', data: { foo: 'bay' } },
      ]);

      await drained;

      const jobs = await queue.getJobCountByTypes('completed');
      expect(jobs).to.be.equal(4);

      await worker.close();
    });
  });

  it('emits drained global event only once when worker is idle', async function () {
    const worker = new Worker(
      queueName,
      async () => {
        await delay(25);
      },
      {
        drainDelay: 1,
        connection,
        prefix,
      },
    );

    let counterDrainedEvents = 0;

    queueEvents.on('drained', () => {
      counterDrainedEvents++;
    });

    await queue.addBulk([
      { name: 'test', data: { foo: 'bar' } },
      { name: 'test', data: { foo: 'baz' } },
    ]);

    await delay(1000);

    await queue.addBulk([
      { name: 'test', data: { foo: 'bar' } },
      { name: 'test', data: { foo: 'baz' } },
    ]);

    await delay(2000);

    const jobs = await queue.getJobCountByTypes('completed');
    expect(jobs).to.be.equal(4);
    expect(counterDrainedEvents).to.be.equal(2);

    await worker.close();
  });

  it('emits drained event in worker when all jobs have been processed', async function () {
    const worker = new Worker(queueName, async () => {}, {
      drainDelay: 1,
      connection,
      prefix,
    });

    const drained = new Promise<void>(resolve => {
      worker.once('drained', () => {
        resolve();
      });
    });

    await queue.addBulk([
      { name: 'test', data: { foo: 'bar' } },
      { name: 'test', data: { foo: 'baz' } },
    ]);

    await drained;

    await delay(10);

    const jobs = await queue.getJobCountByTypes('completed');
    expect(jobs).to.be.equal(2);

    await worker.close();
  });

  it('emits error event when there is an error on other events', async function () {
    const worker = new Worker(queueName, async () => {}, {
      drainDelay: 1,
      connection,
      prefix,
    });

    // Trigger error inside event handler (bar is undefined)
    worker.once('completed', (job: any) => {
      console.log(job.bar.id);
    });

    const error = new Promise<void>(resolve => {
      worker.once('error', () => {
        resolve();
      });
    });

    await queue.add('test', { foo: 'bar' });

    await error;

    const jobs = await queue.getJobCountByTypes('completed');
    expect(jobs).to.be.equal(1);

    await worker.close();
  });

  describe('when one job is added', function () {
    it('emits added event', async function () {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
        },
        {
          drainDelay: 1,
          connection,
          prefix,
        },
      );
      await worker.waitUntilReady();
      const testName = 'test';

      const added = new Promise<void>(resolve => {
        queueEvents.once('added', ({ jobId, name }) => {
          expect(jobId).to.be.equal('1');
          expect(name).to.be.equal(testName);
          resolve();
        });

        queue.add(testName, { foo: 'bar' });
      });

      await added;

      await worker.close();
    });
  });

  describe('when job has been added again', function () {
    it('emits duplicated event', async function () {
      const testName = 'test';
      const worker = new Worker(
        queueName,
        async () => {
          await delay(50);
          await queue.add(testName, { foo: 'bar' }, { jobId: 'a1' });
          await delay(50);
        },
        { autorun: false, connection, prefix },
      );
      await worker.waitUntilReady();

      const completed = new Promise<void>(resolve => {
        worker.on('completed', async function () {
          resolve();
        });
      });

      await queue.add(testName, { foo: 'bar' }, { jobId: 'a1' });

      worker.run();

      await new Promise<void>(resolve => {
        queueEvents.once('duplicated', ({ jobId }) => {
          expect(jobId).to.be.equal('a1');
          resolve();
        });
      });

      await completed;

      await worker.close();
    });
  });

  describe('when job is debounced when added again with same debounce id', function () {
    describe('when ttl is provided', function () {
      it('used a fixed time period and emits debounced event', async function () {
        const testName = 'test';

        const job = await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1', ttl: 2000 } },
        );

        let debouncedCounter = 0;
        let secondJob;
        queueEvents.on('debounced', ({ jobId, debounceId }) => {
          if (debouncedCounter > 1) {
            expect(jobId).to.be.equal(secondJob.id);
            expect(debounceId).to.be.equal('a1');
          } else {
            expect(jobId).to.be.equal(job.id);
            expect(debounceId).to.be.equal('a1');
          }
          debouncedCounter++;
        });

        await delay(1000);
        await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1', ttl: 2000 } },
        );
        await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1', ttl: 2000 } },
        );
        await delay(1100);
        secondJob = await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1', ttl: 2000 } },
        );
        await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1', ttl: 2000 } },
        );
        await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1', ttl: 2000 } },
        );
        await delay(100);

        expect(debouncedCounter).to.be.equal(4);
      });

      describe('when removing debounced job', function () {
        it('removes debounce key', async function () {
          const testName = 'test';

          const job = await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1', ttl: 2000 } },
          );

          let debouncedCounter = 0;
          queueEvents.on('debounced', ({ jobId }) => {
            debouncedCounter++;
          });
          await job.remove();

          await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1', ttl: 2000 } },
          );
          await delay(1000);
          await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1', ttl: 2000 } },
          );
          await delay(1100);
          const secondJob = await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1', ttl: 2000 } },
          );
          await secondJob.remove();

          await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1', ttl: 2000 } },
          );
          await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1', ttl: 2000 } },
          );
          await delay(100);

          expect(debouncedCounter).to.be.equal(2);
        });
      });
    });

    describe('when ttl is not provided', function () {
      it('waits until job is finished before removing debounce key', async function () {
        const testName = 'test';

        const worker = new Worker(
          queueName,
          async () => {
            await delay(100);
            await queue.add(
              testName,
              { foo: 'bar' },
              { debounce: { id: 'a1' } },
            );
            await delay(100);
            await queue.add(
              testName,
              { foo: 'bar' },
              { debounce: { id: 'a1' } },
            );
            await delay(100);
          },
          {
            autorun: false,
            connection,
            prefix,
          },
        );
        await worker.waitUntilReady();

        let debouncedCounter = 0;

        const completing = new Promise<void>(resolve => {
          queueEvents.once('completed', ({ jobId }) => {
            expect(jobId).to.be.equal('1');
            resolve();
          });

          queueEvents.on('debounced', ({ jobId }) => {
            debouncedCounter++;
          });
        });

        worker.run();

        await queue.add(testName, { foo: 'bar' }, { debounce: { id: 'a1' } });

        await completing;

        const secondJob = await queue.add(
          testName,
          { foo: 'bar' },
          { debounce: { id: 'a1' } },
        );

        const count = await queue.getJobCountByTypes();

        expect(count).to.be.eql(2);

        expect(debouncedCounter).to.be.equal(2);
        expect(secondJob.id).to.be.equal('4');
        await worker.close();
      });

      describe('when removing debounced job', function () {
        it('removes debounce key', async function () {
          const testName = 'test';

          const job = await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1' } },
          );

          let debouncedCounter = 0;
          queueEvents.on('debounced', ({ jobId }) => {
            debouncedCounter++;
          });
          await job.remove();

          await queue.add(testName, { foo: 'bar' }, { debounce: { id: 'a1' } });

          await queue.add(testName, { foo: 'bar' }, { debounce: { id: 'a1' } });
          await delay(100);
          const secondJob = await queue.add(
            testName,
            { foo: 'bar' },
            { debounce: { id: 'a1' } },
          );
          await secondJob.remove();

          expect(debouncedCounter).to.be.equal(2);
        });
      });
    });
  });

  describe('when job is deduplicated when added again with same debounce id', function () {
    describe('when ttl is provided', function () {
      it('used a fixed time period and emits debounced event', async function () {
        const testName = 'test';

        const job = await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1', ttl: 2000 } },
        );

        let deduplicatedCounter = 0;
        let secondJob;
        queueEvents.on('deduplicated', ({ jobId, deduplicationId }) => {
          if (deduplicatedCounter > 1) {
            expect(jobId).to.be.equal(secondJob.id);
            expect(deduplicationId).to.be.equal('a1');
          } else {
            expect(jobId).to.be.equal(job.id);
            expect(deduplicationId).to.be.equal('a1');
          }
          deduplicatedCounter++;
        });

        await delay(1000);
        await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1', ttl: 2000 } },
        );
        await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1', ttl: 2000 } },
        );
        await delay(1100);
        secondJob = await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1', ttl: 2000 } },
        );
        await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1', ttl: 2000 } },
        );
        await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1', ttl: 2000 } },
        );
        await delay(100);

        expect(deduplicatedCounter).to.be.equal(4);
      });

      describe('when removing deduplicated job', function () {
        it('removes deduplication key', async function () {
          const testName = 'test';

          const job = await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1', ttl: 2000 } },
          );

          let deduplicatedCounter = 0;
          queueEvents.on('deduplicated', ({ jobId }) => {
            deduplicatedCounter++;
          });
          await job.remove();

          await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1', ttl: 2000 } },
          );
          await delay(1000);
          await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1', ttl: 2000 } },
          );
          await delay(1100);
          const secondJob = await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1', ttl: 2000 } },
          );
          await secondJob.remove();

          await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1', ttl: 2000 } },
          );
          await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1', ttl: 2000 } },
          );
          await delay(100);

          expect(deduplicatedCounter).to.be.equal(2);
        });
      });
    });

    describe('when ttl is not provided', function () {
      it('waits until job is finished before removing debounce key', async function () {
        const testName = 'test';

        const worker = new Worker(
          queueName,
          async () => {
            await delay(100);
            await queue.add(
              testName,
              { foo: 'bar' },
              { deduplication: { id: 'a1' } },
            );
            await delay(100);
            await queue.add(
              testName,
              { foo: 'bar' },
              { deduplication: { id: 'a1' } },
            );
            await delay(100);
          },
          {
            autorun: false,
            connection,
            prefix,
          },
        );
        await worker.waitUntilReady();

        let deduplicatedCounter = 0;

        const completing = new Promise<void>(resolve => {
          queueEvents.once('completed', ({ jobId }) => {
            expect(jobId).to.be.equal('1');
            resolve();
          });

          queueEvents.on('deduplicated', ({ jobId }) => {
            deduplicatedCounter++;
          });
        });

        worker.run();

        await queue.add(testName, { foo: 'bar' }, { debounce: { id: 'a1' } });

        await completing;

        const secondJob = await queue.add(
          testName,
          { foo: 'bar' },
          { deduplication: { id: 'a1' } },
        );

        const count = await queue.getJobCountByTypes();

        expect(count).to.be.eql(2);

        expect(deduplicatedCounter).to.be.equal(2);
        expect(secondJob.id).to.be.equal('4');
        await worker.close();
      });

      describe('when removing deduplicated job', function () {
        it('removes deduplication key', async function () {
          const testName = 'test';

          const job = await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1' } },
          );

          let deduplicatedCounter = 0;
          queueEvents.on('deduplicated', ({ jobId }) => {
            deduplicatedCounter++;
          });
          await job.remove();

          await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1' } },
          );

          await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1' } },
          );
          await delay(100);
          const secondJob = await queue.add(
            testName,
            { foo: 'bar' },
            { deduplication: { id: 'a1' } },
          );
          await secondJob.remove();

          expect(deduplicatedCounter).to.be.equal(2);
        });
      });
    });
  });

  it('should emit an event when a job becomes active', async () => {
    const worker = new Worker(queueName, async job => {}, {
      connection,
      prefix,
    });

    await queue.add('test', {});

    const completed = new Promise<void>(resolve => {
      worker.once('active', function () {
        worker.once('completed', async function () {
          await worker.close();
          resolve();
        });
      });
    });

    await completed;
    await worker.close();
  });

  describe('when one job is a parent', function () {
    it('emits waiting-children and waiting event', async function () {
      const worker = new Worker(queueName, async () => {}, {
        drainDelay: 1,
        connection,
        prefix,
      });
      const name = 'parent-job';
      const childrenQueueName = `children-queue-${v4()}`;

      const childrenWorker = new Worker(
        childrenQueueName,
        async () => {
          await delay(100);
        },
        {
          drainDelay: 1,
          connection,
          prefix,
        },
      );
      const waitingChildren = new Promise<void>((resolve, reject) => {
        queueEvents.once('waiting-children', async ({ jobId }) => {
          try {
            const job = await queue.getJob(jobId);
            const state = await job.getState();
            expect(state).to.be.equal('waiting-children');
            expect(job.name).to.be.equal(name);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      const waiting = new Promise<void>((resolve, reject) => {
        queueEvents.on('waiting', async ({ jobId, prev }) => {
          try {
            const job = await queue.getJob(jobId);
            expect(prev).to.be.equal('waiting-children');
            if (job.name === name) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      const flow = new FlowProducer({ connection, prefix });
      await flow.add({
        name,
        queueName,
        data: {},
        children: [
          { name: 'test', data: { foo: 'bar' }, queueName: childrenQueueName },
        ],
      });

      await waitingChildren;
      await waiting;

      await worker.close();
      await childrenWorker.close();
      await flow.close();
      await removeAllQueueData(new IORedis(redisHost), childrenQueueName);
    });
  });

  it('should listen to global events', async () => {
    const worker = new Worker(queueName, async job => {}, {
      connection,
      prefix,
    });

    let state: string;
    await delay(50); // additional delay since XREAD from '$' is unstable
    queueEvents.on('waiting', function ({ jobId }) {
      expect(jobId).to.be.equal('1');
      expect(state).to.be.undefined;
      state = 'waiting';
    });
    queueEvents.once('active', function ({ jobId, prev }) {
      expect(jobId).to.be.equal('1');
      expect(prev).to.be.equal('waiting');
      expect(state).to.be.equal('waiting');
      state = 'active';
    });

    const completed = new Promise<void>(resolve => {
      queueEvents.once('completed', async function ({ jobId, returnvalue }) {
        expect(jobId).to.be.equal('1');
        expect(returnvalue).to.be.null;
        expect(state).to.be.equal('active');
        resolve();
      });
    });

    await queue.add('test', {});

    await completed;
    await worker.close();
  });

  describe('when jobs removal is attempted on non-existed records', async () => {
    it('should not publish removed events', async () => {
      const numRemovals = 100;
      const trimmedQueue = new Queue(queueName, {
        connection,
        prefix,
      });

      const client = await trimmedQueue.client;

      for (let i = 0; i < numRemovals; i++) {
        await trimmedQueue.remove(i.toString());
      }

      const eventsLength = await client.xlen(trimmedQueue.keys.events);

      expect(eventsLength).to.be.eql(0);

      await trimmedQueue.close();
      await removeAllQueueData(new IORedis(redisHost), queueName);
    });
  });

  describe('when maxLen is 0', function () {
    it('should trim events automatically', async () => {
      const trimmedQueue = new Queue(queueName, {
        connection,
        prefix,
        streams: {
          events: {
            maxLen: 0,
          },
        },
      });

      const worker = new Worker(
        queueName,
        async () => {
          await delay(100);
        },
        { connection, prefix },
      );

      await trimmedQueue.waitUntilReady();
      await worker.waitUntilReady();

      const client = await trimmedQueue.client;

      const waitCompletedEvent = new Promise<void>(resolve => {
        queueEvents.on(
          'completed',
          after(3, async () => {
            resolve();
          }),
        );
      });

      await trimmedQueue.addBulk([
        { name: 'test', data: { foo: 'bar' } },
        { name: 'test', data: { foo: 'baz' } },
        { name: 'test', data: { foo: 'bar' } },
      ]);

      await waitCompletedEvent;

      const [[id, [_, drained]], [, [, completed]]] = await client.xrevrange(
        trimmedQueue.keys.events,
        '+',
        '-',
      );

      expect(drained).to.be.equal('drained');
      expect(completed).to.be.equal('completed');

      const eventsLength = await client.xlen(trimmedQueue.keys.events);

      expect(eventsLength).to.be.lte(2);

      await worker.close();
      await trimmedQueue.close();
      await removeAllQueueData(new IORedis(redisHost), queueName);
    });
  });

  describe('when maxLen is greater than 0', function () {
    it('should trim events so its length is at least the threshold', async () => {
      const numJobs = 80;
      const trimmedQueue = new Queue(queueName, {
        connection,
        prefix,
        streams: {
          events: {
            maxLen: 20,
          },
        },
      });

      const worker = new Worker(
        queueName,
        async () => {
          await delay(50);
        },
        { connection, prefix },
      );

      await trimmedQueue.waitUntilReady();
      await worker.waitUntilReady();

      const client = await trimmedQueue.client;

      const waitCompletedEvent = new Promise<void>(resolve => {
        queueEvents.on(
          'completed',
          after(numJobs, async () => {
            resolve();
          }),
        );
      });

      const jobs = Array.from(Array(numJobs).keys()).map(() => ({
        name: 'test',
        data: { foo: 'bar' },
      }));

      await trimmedQueue.addBulk(jobs);

      await waitCompletedEvent;

      const eventsLength = await client.xlen(trimmedQueue.keys.events);

      expect(eventsLength).to.be.lte(35);
      expect(eventsLength).to.be.gte(20);

      await worker.close();
      await trimmedQueue.close();
      await removeAllQueueData(new IORedis(redisHost), queueName);
    });

    describe('when jobs are moved to delayed', function () {
      it('should trim events so its length is at least the threshold', async () => {
        const numJobs = 80;
        const trimmedQueue = new Queue(queueName, {
          connection,
          prefix,
          streams: {
            events: {
              maxLen: 20,
            },
          },
        });

        const worker = new Worker(
          queueName,
          async () => {
            await delay(50);
            throw new Error('error');
          },
          { connection, prefix },
        );

        await trimmedQueue.waitUntilReady();
        await worker.waitUntilReady();

        const client = await trimmedQueue.client;

        const waitDelayedEvent = new Promise<void>(resolve => {
          queueEvents.on(
            'delayed',
            after(numJobs, async () => {
              resolve();
            }),
          );
        });

        const jobs = Array.from(Array(numJobs).keys()).map(() => ({
          name: 'test',
          data: { foo: 'bar' },
          opts: {
            attempts: 2,
            backoff: 5000,
          },
        }));
        await trimmedQueue.addBulk(jobs);

        await waitDelayedEvent;

        const eventsLength = await client.xlen(trimmedQueue.keys.events);

        expect(eventsLength).to.be.lte(35);
        expect(eventsLength).to.be.gte(20);

        await worker.close();
        await trimmedQueue.close();
        await removeAllQueueData(new IORedis(redisHost), queueName);
      });
    });

    describe('when jobs are retried immediately', function () {
      it('should trim events so its length is at least the threshold', async () => {
        const numJobs = 80;
        const trimmedQueue = new Queue(queueName, {
          connection,
          prefix,
          streams: {
            events: {
              maxLen: 20,
            },
          },
        });

        const worker = new Worker(
          queueName,
          async () => {
            await delay(25);
            throw new Error('error');
          },
          { connection, prefix },
        );

        await trimmedQueue.waitUntilReady();
        await worker.waitUntilReady();

        const client = await trimmedQueue.client;

        const waitCompletedEvent = new Promise<void>(resolve => {
          queueEvents.on('waiting', async ({ jobId, prev }) => {
            if (prev === 'failed' && jobId === numJobs + '') {
              resolve();
            }
          });
        });

        const jobs = Array.from(Array(numJobs).keys()).map(() => ({
          name: 'test',
          data: { foo: 'bar' },
          opts: {
            attempts: 2,
          },
        }));
        await trimmedQueue.addBulk(jobs);

        await waitCompletedEvent;

        const eventsLength = await client.xlen(trimmedQueue.keys.events);

        expect(eventsLength).to.be.lte(35);
        expect(eventsLength).to.be.gte(20);

        await worker.close();
        await trimmedQueue.close();
        await removeAllQueueData(new IORedis(redisHost), queueName);
      });
    });

    describe('when jobs removal is attempted', async () => {
      it('should trim events so its length is at least the threshold', async () => {
        const numRemovals = 200;
        const trimmedQueue = new Queue(queueName, {
          connection,
          prefix,
          streams: {
            events: {
              maxLen: 20,
            },
          },
        });

        const client = await trimmedQueue.client;

        const jobs = Array.from(Array(numRemovals).keys()).map(() => ({
          name: 'test',
          data: { foo: 'bar' },
        }));
        await trimmedQueue.addBulk(jobs);

        for (let i = 1; i <= numRemovals; i++) {
          await trimmedQueue.remove(i.toString());
        }

        const eventsLength = await client.xlen(trimmedQueue.keys.events);

        expect(eventsLength).to.be.lte(100);
        expect(eventsLength).to.be.gte(20);

        await trimmedQueue.close();
        await removeAllQueueData(new IORedis(redisHost), queueName);
      });
    });
  });

  it('should trim events manually', async () => {
    const queueName = 'test-manual-' + v4();
    const trimmedQueue = new Queue(queueName, { connection, prefix });

    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});

    const client = await trimmedQueue.client;

    let eventsLength = await client.xlen(trimmedQueue.keys.events);

    expect(eventsLength).to.be.equal(8);

    await trimmedQueue.trimEvents(0);

    eventsLength = await client.xlen(trimmedQueue.keys.events);

    expect(eventsLength).to.be.equal(0);

    await trimmedQueue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  describe('when publishing custom events', function () {
    it('emits waiting when a job has been added', async () => {
      const queueName2 = `test-${v4()}`;
      const queueEventsProducer = new QueueEventsProducer(queueName2, {
        connection,
        prefix,
      });
      const queueEvents2 = new QueueEvents(queueName2, {
        autorun: false,
        connection,
        prefix,
        lastEventId: '0-0',
      });
      await queueEvents2.waitUntilReady();

      interface CustomListener extends QueueEventsListener {
        example: (args: { custom: string }, id: string) => void;
      }
      const customEvent = new Promise<void>(resolve => {
        queueEvents2.on<CustomListener>('example', async ({ custom }) => {
          await delay(250);
          await expect(custom).to.be.equal('value');
          resolve();
        });
      });

      interface CustomEventPayload {
        eventName: string;
        custom: string;
      }

      await queueEventsProducer.publishEvent<CustomEventPayload>({
        eventName: 'example',
        custom: 'value',
      });

      queueEvents2.run();
      await customEvent;

      await queueEventsProducer.close();
      await queueEvents2.close();
      await removeAllQueueData(new IORedis(redisHost), queueName2);
    });
  });
});
