import { Queue } from '@src/classes';
import { QueueEvents } from '@src/classes/queue-events';
import { Worker } from '@src/classes/worker';
import { expect } from 'chai';
import IORedis from 'ioredis';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'node-uuid';

describe('events', function() {
  this.timeout(4000);
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;
  let client: IORedis.Redis;

  beforeEach(function() {
    client = new IORedis();
    return client.flushdb();
  });

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
    queueEvents = new QueueEvents(queueName);
    return queueEvents.waitUntilReady();
  });

  afterEach(async function() {
    await queue.close();
    await queueEvents.close();
    return client.quit();
  });

  it('should emit waiting when a job has been added', async function() {
    const waiting = new Promise(resolve => {
      queue.on('waiting', resolve);
    });

    await queue.add('test', { foo: 'bar' });

    await waiting;
  });

  it('should emit global waiting event when a job has been added', async function() {
    const waiting = new Promise(resolve => {
      queue.on('waiting', resolve);
    });

    await queue.add('test', { foo: 'bar' });

    await waiting;
  });

  it('emits drained global drained event when all jobs have been processed', async function() {
    const worker = new Worker(queueName, async job => {}, {
      drainDelay: 1,
    });

    const drained = new Promise(resolve => {
      queueEvents.once('drained', resolve);
    });

    await queue.add('test', { foo: 'bar' });
    await queue.add('test', { foo: 'baz' });

    await drained;

    const jobs = await queue.getJobCountByTypes('completed');
    expect(jobs).to.be.equal(2);

    await worker.close();
  });

  it('emits drained event when all jobs have been processed', async function() {
    const worker = new Worker(queueName, async job => {}, {
      drainDelay: 1,
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

  it('should emit an event when a job becomes active', async () => {
    const worker = new Worker(queueName, async job => {});

    await queue.add('test', {});

    const completed = new Promise(resolve => {
      worker.once('active', function() {
        worker.once('completed', async function() {
          await worker.close();
          resolve();
        });
      });
    });

    await completed;
  });

  it('should listen to global events', async () => {
    const worker = new Worker(queueName, async job => {});

    let state: string;
    queueEvents.on('waiting', function() {
      expect(state).to.be.undefined;
      state = 'waiting';
    });
    queueEvents.once('active', function() {
      expect(state).to.be.equal('waiting');
      state = 'active';
    });

    const completed = new Promise(resolve => {
      queueEvents.once('completed', async function() {
        expect(state).to.be.equal('active');
        resolve();
      });
    });

    await queue.add('test', {});

    await completed;
    await worker.close();
  });

  it('should trim events automatically', async () => {
    const worker = new Worker('test', async () => {});
    const trimmedQueue = new Queue('test', {
      streams: {
        events: {
          maxLen: 0,
        },
      },
    });

    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});

    const waitForCompletion = new Promise(resolve => {
      worker.on('drained', resolve);
    });

    await waitForCompletion;
    await worker.close();

    const [[id, [_, event]]] = await trimmedQueue.client.xrange(
      trimmedQueue.keys.events,
      '-',
      '+',
    );

    expect(event).to.be.equal('drained');

    const eventsLength = await trimmedQueue.client.xlen(
      trimmedQueue.keys.events,
    );

    expect(eventsLength).to.be.equal(1);

    await trimmedQueue.close();
  });

  it('should trim events manually', async () => {
    const trimmedQueue = new Queue('test-manual');

    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});
    await trimmedQueue.add('test', {});

    await trimmedQueue.waitUntilReady();

    let eventsLength = await trimmedQueue.client.xlen(trimmedQueue.keys.events);

    expect(eventsLength).to.be.equal(4);

    await trimmedQueue.trimEvents(0);

    eventsLength = await trimmedQueue.client.xlen(trimmedQueue.keys.events);

    expect(eventsLength).to.be.equal(0);

    await trimmedQueue.close();
  });
});
