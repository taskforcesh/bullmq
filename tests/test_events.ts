import * as IORedis from 'ioredis';
import { v4 } from 'uuid';
import { expect } from 'chai';
import { after } from 'lodash';
import { beforeEach, describe, it } from 'mocha';
import { FlowProducer, Queue, QueueEvents, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('events', function () {
  this.timeout(8000);
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
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  describe('when autorun option is provided as false', function () {
    it('emits waiting when a job has been added', async () => {
      const queueName2 = `test-${v4()}`;
      const queue2 = new Queue(queueName2, { connection });
      const queueEvents2 = new QueueEvents(queueName2, {
        autorun: false,
        connection,
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
      await removeAllQueueData(new IORedis(), queueName2);
    });

    describe('when run method is called when queueEvent is running', function () {
      it('throws error', async () => {
        const queueName2 = `test-${v4()}`;
        const queue2 = new Queue(queueName2, { connection });
        const queueEvents2 = new QueueEvents(queueName2, {
          autorun: false,
          connection,
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
        await removeAllQueueData(new IORedis(), queueName2);
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
    const waiting = new Promise(resolve => {
      queueEvents.on('waiting', resolve);
    });

    await queue.add('test', { foo: 'bar' });

    await waiting;
  });

  it('emits cleaned global event when jobs were cleaned', async function () {
    const worker = new Worker(queueName, async job => {}, { connection });

    worker.on(
      'completed',
      after(50, async function () {
        await queue.clean(0, 0, 'completed');
      }),
    );

    for (let i = 0; i < 50; i++) {
      await queue.add('test', { foo: 'bar' });
    }

    await new Promise<void>(resolve => {
      queueEvents.once('cleaned', async ({ count }) => {
        expect(count).to.be.eql('50');
        const actualCount = await queue.count();
        expect(actualCount).to.be.equal(0);
        resolve();
      });
    });
  });

  it('emits drained global event when all jobs have been processed', async function () {
    const worker = new Worker(queueName, async job => {}, {
      drainDelay: 1,
      connection,
    });

    const drained = new Promise<void>(resolve => {
      queueEvents.once('drained', id => {
        expect(id).to.be.string;
        resolve();
      });
    });

    await queue.add('test', { foo: 'bar' });
    await queue.add('test', { foo: 'baz' });

    await drained;

    const jobs = await queue.getJobCountByTypes('completed');
    expect(jobs).to.be.equal(2);

    await worker.close();
  });

  it('emits drained event when all jobs have been processed', async function () {
    const worker = new Worker(queueName, async job => {}, {
      drainDelay: 1,
      connection,
    });

    const drained = new Promise(resolve => {
      worker.once('drained', resolve);
    });

    await queue.add('test', { foo: 'bar' });
    await queue.add('test', { foo: 'baz' });

    await drained;

    const jobs = await queue.getJobCountByTypes('completed');
    expect(jobs).to.be.equal(2);

    await worker.close();
  });

  it('emits error event when there is an error on other events', async function () {
    const worker = new Worker(queueName, async job => {}, {
      drainDelay: 1,
      connection,
    });

    // Trigger error inside event handler (bar is undefined)
    worker.once('completed', (job: any) => {
      console.log(job.bar.id);
    });

    const error = new Promise<void>(resolve => {
      worker.once('error', resolve);
    });

    await queue.add('test', { foo: 'bar' });

    await error;

    const jobs = await queue.getJobCountByTypes('completed');
    expect(jobs).to.be.equal(1);

    await worker.close();
  });

  it('emits added event when one job is added', async function () {
    const worker = new Worker(queueName, async job => {}, {
      drainDelay: 1,
      connection,
    });
    const testName = 'test';
    const testData = { foo: 'bar' };

    const added = new Promise<void>(resolve => {
      queueEvents.once('added', ({ jobId, name, data, opts }) => {
        expect(jobId).to.be.equal('1');
        expect(name).to.be.equal(testName);
        expect(data).to.be.equal(JSON.stringify(testData));
        expect(JSON.parse(opts)).to.be.deep.equal({ attempts: 0, delay: 0 });
        resolve();
      });
    });

    await queue.add(testName, { foo: 'bar' });

    await added;

    await worker.close();
  });

  it('should emit an event when a job becomes active', async () => {
    const worker = new Worker(queueName, async job => {}, { connection });

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

  it('emits waiting-children event when one job is a parent', async function () {
    const worker = new Worker(queueName, async job => {}, {
      drainDelay: 1,
      connection,
    });
    const name = 'parent-job';
    const childrenQueueName = `children-queue-${v4()}`;

    const waitingChildren = new Promise<void>(resolve => {
      queueEvents.once('waiting-children', async ({ jobId }) => {
        const job = await queue.getJob(jobId);
        const state = await job.getState();
        expect(state).to.be.equal('waiting-children');
        expect(job.name).to.be.equal(name);
        resolve();
      });
    });

    const flow = new FlowProducer({ connection });
    await flow.add({
      name,
      queueName,
      data: {},
      children: [
        { name: 'test', data: { foo: 'bar' }, queueName: childrenQueueName },
      ],
    });

    await waitingChildren;

    await worker.close();
    await removeAllQueueData(new IORedis(), childrenQueueName);
  });

  it('should listen to global events', async () => {
    const worker = new Worker(queueName, async job => {}, { connection });

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

  it('should trim events automatically', async () => {
    const trimmedQueue = new Queue(queueName, {
      connection,
      streams: {
        events: {
          maxLen: 0,
        },
      },
    });

    await queueEvents.client;

    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});

    const worker = new Worker(queueName, async () => {}, { connection });

    const waitForCompletion = new Promise(resolve => {
      queueEvents.on('drained', resolve);
    });

    await waitForCompletion;
    await worker.close();

    const client = await trimmedQueue.client;

    const [[id, [_, event]]] = await client.xrevrange(
      trimmedQueue.keys.events,
      '+',
      '-',
    );

    expect(event).to.be.equal('drained');

    const eventsLength = await client.xlen(trimmedQueue.keys.events);

    expect(eventsLength).to.be.lte(3);

    await trimmedQueue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should trim events manually', async () => {
    const queueName = 'test-manual-' + v4();
    const trimmedQueue = new Queue(queueName, { connection });

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
    await removeAllQueueData(new IORedis(), queueName);
  });
});
