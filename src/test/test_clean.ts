import { Queue, QueueEvents, Worker } from '../classes';
import { delay, removeAllQueueData } from '@src/utils';
import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { after } from 'lodash';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';

describe('Cleaner', () => {
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

  it('should clean an empty queue', async () => {
    await queue.waitUntilReady();

    const waitCleaned = new Promise(resolve => {
      queue.on('cleaned', (jobs, type) => {
        expect(type).to.be.eql('completed');
        expect(jobs.length).to.be.eql(0);
        resolve();
      });
    });

    const jobs = await queue.clean(0, 0);

    expect(jobs.length).to.be.eql(0);

    await waitCleaned;
  });

  it('should clean two jobs from the queue', async () => {
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });

    const worker = new Worker(queueName, async job => {});
    await worker.waitUntilReady();

    queue.on(
      'completed',
      after(2, async () => {
        const jobs = await queue.clean(0, 0);
        expect(jobs.length).to.be.eql(2);
      }),
    );

    await worker.close();
  });

  it('should only remove a job outside of the grace period', async () => {
    const worker = new Worker(queueName, async job => {});
    await worker.waitUntilReady();

    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await delay(200);
    await queue.add('test', { some: 'data' });
    await queue.clean(100, 100);
    await delay(100);
    const jobs = await queue.getCompleted();
    expect(jobs.length).to.be.eql(1);
  });

  it('should clean all failed jobs', async () => {
    const worker = new Worker(queueName, async job => {
      throw new Error('It failed');
    });
    await worker.waitUntilReady();

    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });

    await delay(100);
    const jobs = await queue.clean(0, 0, 'failed');
    expect(jobs.length).to.be.eql(2);
    const count = await queue.count();
    expect(count).to.be.eql(0);
  });

  it('should clean all waiting jobs', async () => {
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await delay(100);
    const jobs = await queue.clean(0, 0, 'wait');
    expect(jobs.length).to.be.eql(2);
    const count = await queue.count();
    expect(count).to.be.eql(0);
  });

  it('should clean all delayed jobs', async () => {
    await queue.add('test', { some: 'data' }, { delay: 5000 });
    await queue.add('test', { some: 'data' }, { delay: 5000 });
    await delay(100);
    const jobs = await queue.clean(0, 0, 'delayed');
    expect(jobs.length).to.be.eql(2);
    const count = await queue.count();
    expect(count).to.be.eql(0);
  });

  it('should clean the number of jobs requested', async () => {
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });
    await delay(100);
    const jobs = await queue.clean(0, 1, 'wait');
    expect(jobs.length).to.be.eql(1);
    const count = await queue.count();
    expect(count).to.be.eql(2);
  });

  it('should clean a job without a timestamp', async () => {
    const worker = new Worker(queueName, async job => {
      throw new Error('It failed');
    });
    await worker.waitUntilReady();

    const client = new IORedis();

    await queue.add('test', { some: 'data' });
    await queue.add('test', { some: 'data' });

    await delay(100);
    await client.hdel(`bull:${queueName}:1`, 'timestamp');
    const jobs = await queue.clean(0, 0, 'failed');
    expect(jobs.length).to.be.eql(2);
    const failed = await queue.getFailed();
    expect(failed.length).to.be.eql(0);
  });
});
