import { Queue, QueueEvents, QueueScheduler, Worker } from '../classes';
import { delay, removeAllQueueData } from '@src/utils';
import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';

describe('Obliterate', () => {
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
    queueEvents = new QueueEvents(queueName);
    await queueEvents.waitUntilReady();
  });

  afterEach(async function() {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should obliterate an empty queue', async () => {
    await queue.waitUntilReady();

    await queue.obliterate();

    const client = await queue.client;
    const keys = await client.keys(`bull:${queue.name}:*`);

    expect(keys.length).to.be.eql(0);
  });

  it('should obliterate a queue with jobs in different statuses', async () => {
    await queue.waitUntilReady();

    await queue.add('test', { foo: 'bar' });
    await queue.add('test', { foo: 'bar2' });
    await queue.add('test', { foo: 'bar3' }, { delay: 5000 });
    const job = await queue.add('test', { qux: 'baz' });

    let first = true;
    const worker = new Worker(queue.name, async job => {
      if (first) {
        first = false;
        throw new Error('failed first');
      }
      return delay(250);
    });
    await worker.waitUntilReady();

    await job.waitUntilFinished(queueEvents);

    await queue.obliterate();
    const client = await queue.client;
    const keys = await client.keys(`bull:${queue.name}:*`);
    expect(keys.length).to.be.eql(0);

    await worker.close();
  });

  it('should raise exception if queue has active jobs', async () => {
    await queue.waitUntilReady();

    await queue.add('test', { foo: 'bar' });
    const job = await queue.add('test', { qux: 'baz' });

    await queue.add('test', { foo: 'bar2' });
    await queue.add('test', { foo: 'bar3' }, { delay: 5000 });

    let first = true;
    const worker = new Worker(queue.name, async job => {
      if (first) {
        first = false;
        throw new Error('failed first');
      }
      return delay(250);
    });
    await worker.waitUntilReady();

    await job.waitUntilFinished(queueEvents);

    try {
      await queue.obliterate();
    } catch (err) {
      const client = await queue.client;
      const keys = await client.keys(`bull:${queue.name}:*`);
      expect(keys.length).to.be.not.eql(0);

      await worker.close();
      return;
    }

    throw new Error('Should raise an exception if there are active jobs');
  });

  it('should obliterate if queue has active jobs using "force"', async () => {
    await queue.waitUntilReady();

    await queue.add('test', { foo: 'bar' });
    const job = await queue.add('test', { qux: 'baz' });

    await queue.add('test', { foo: 'bar2' });
    await queue.add('test', { foo: 'bar3' }, { delay: 5000 });

    let first = true;
    const worker = new Worker(queue.name, async job => {
      if (first) {
        first = false;
        throw new Error('failed first');
      }
      return delay(250);
    });
    await worker.waitUntilReady();

    await job.waitUntilFinished(queueEvents);
    await queue.obliterate({ force: true });
    const client = await queue.client;
    const keys = await client.keys(`bull:${queue.name}:*`);
    expect(keys.length).to.be.eql(0);

    await worker.close();
  });
});
