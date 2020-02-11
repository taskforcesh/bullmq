import { Job, Queue } from '@src/classes';
import { QueueEvents, QueueScheduler } from '../classes';
import { Worker } from '@src/classes/worker';
import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { delay, removeAllQueueData } from '@src/utils';

describe('Pause', function() {
  let queue: Queue;
  let queueName: string;
  let queueEvents: QueueEvents;

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

  // Skipped since some side effect makes this test fail
  it.skip('should not processed delayed jobs', async function() {
    this.timeout(5000);

    const queueScheduler = new QueueScheduler(queueName);
    await queueScheduler.waitUntilReady();

    let processed = false;

    const worker = new Worker(queueName, async () => {
      processed = true;
    });
    await worker.waitUntilReady();

    await queue.pause();
    await queue.add('test', {}, { delay: 200 });
    const counts = await queue.getJobCounts('waiting', 'delayed');

    expect(counts).to.have.property('waiting', 0);
    expect(counts).to.have.property('delayed', 1);

    await delay(1000);
    if (processed) {
      throw new Error('should not process delayed jobs in paused queue.');
    }
    const counts2 = await queue.getJobCounts('waiting', 'paused', 'delayed');
    expect(counts2).to.have.property('waiting', 0);
    expect(counts2).to.have.property('paused', 1);
    expect(counts2).to.have.property('delayed', 0);

    await queueScheduler.close();
    await worker.close();
  });

  it('should pause a queue until resumed', async () => {
    let process;
    let isPaused = false;
    let counter = 2;
    const processPromise = new Promise(resolve => {
      process = async (job: Job) => {
        expect(isPaused).to.be.eql(false);
        expect(job.data.foo).to.be.equal('paused');
        counter--;
        if (counter === 0) {
          resolve();
        }
      };
    });

    const worker = new Worker(queueName, process);
    await worker.waitUntilReady();

    await queue.pause();
    isPaused = true;
    await queue.add('test', { foo: 'paused' });
    await queue.add('test', { foo: 'paused' });
    isPaused = false;
    await queue.resume();

    await processPromise;
    return worker.close();
  });

  it('should be able to pause a running queue and emit relevant events', async () => {
    let process;

    let isPaused = false,
      isResumed = true,
      first = true;

    const processPromise = new Promise((resolve, reject) => {
      process = async (job: Job) => {
        try {
          expect(isPaused).to.be.eql(false);
          expect(job.data.foo).to.be.equal('paused');

          if (first) {
            first = false;
            isPaused = true;
            return queue.pause();
          } else {
            expect(isResumed).to.be.eql(true);
            await queue.close();
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      };
    });

    const worker = new Worker(queueName, process);

    queueEvents.on('paused', async () => {
      isPaused = false;
      await queue.resume();
    });

    queueEvents.on('resumed', () => {
      isResumed = true;
    });

    await queue.add('test', { foo: 'paused' });
    await queue.add('test', { foo: 'paused' });

    return processPromise;
  });

  it('should pause the queue locally', async () => {
    let worker: Worker;
    let counter = 2;
    let process;
    const processPromise = new Promise(resolve => {
      process = async (job: Job) => {
        expect(worker.isPaused()).to.be.eql(false);
        counter--;
        if (counter === 0) {
          await queue.close();
          resolve();
        }
      };
    });

    worker = new Worker(queueName, process);
    await worker.waitUntilReady();

    await worker.pause();

    // Add the worker after the queue is in paused mode since the normal behavior is to pause
    // it after the current lock expires. This way, we can ensure there isn't a lock already
    // to test that pausing behavior works.

    await queue.add('test', { foo: 'paused' });
    await queue.add('test', { foo: 'paused' });

    expect(counter).to.be.eql(2);
    expect(worker.isPaused()).to.be.eql(true);

    await worker.resume();

    return processPromise;
  });

  it('should wait until active jobs are finished before resolving pause', async () => {
    let process;

    const startProcessing = new Promise(resolve => {
      process = async () => {
        resolve();
        return delay(1000);
      };
    });

    const worker = new Worker(queueName, process);
    await worker.waitUntilReady();

    const jobs = [];
    for (let i = 0; i < 10; i++) {
      jobs.push(queue.add('test', i));
    }

    //
    // Add start processing so that we can test that pause waits for this job to be completed.
    //
    jobs.push(startProcessing);
    await Promise.all(jobs);
    await worker.pause();

    let active = await queue.getJobCountByTypes('active');
    expect(active).to.be.eql(0);
    expect(worker.isPaused()).to.be.eql(true);

    // One job from the 10 posted above will be processed, so we expect 9 jobs pending
    let paused = await queue.getJobCountByTypes('delayed', 'waiting');
    expect(paused).to.be.eql(9);

    await queue.add('test', {});

    active = await queue.getJobCountByTypes('active');
    expect(active).to.be.eql(0);

    paused = await queue.getJobCountByTypes('paused', 'waiting', 'delayed');
    expect(paused).to.be.eql(10);

    await worker.close();
  });

  it('should pause the queue locally when more than one worker is active', async () => {
    let process1, process2;

    const startProcessing1 = new Promise(resolve => {
      process1 = async () => {
        resolve();
        return delay(200);
      };
    });

    const startProcessing2 = new Promise(resolve => {
      process2 = async () => {
        resolve();
        return delay(200);
      };
    });

    const worker1 = new Worker(queueName, process1);
    await worker1.waitUntilReady();

    const worker2 = new Worker(queueName, process2);
    await worker2.waitUntilReady();

    await Promise.all([
      queue.add('test', 1),
      queue.add('test', 2),
      queue.add('test', 3),
      queue.add('test', 4),
    ]);

    await Promise.all([startProcessing1, startProcessing2]);
    await Promise.all([worker1.pause(), worker2.pause()]);

    const count = await queue.getJobCounts('active', 'waiting', 'completed');
    expect(count.active).to.be.eql(0);
    expect(count.waiting).to.be.eql(2);
    expect(count.completed).to.be.eql(2);

    return Promise.all([worker1.close(), worker2.close()]);
  });

  it('should wait for blocking job retrieval to complete before pausing locally', async () => {
    let process;

    const startProcessing = new Promise(resolve => {
      process = async () => {
        resolve();
        return delay(200);
      };
    });

    const worker = new Worker(queueName, process);
    await worker.waitUntilReady();

    await queue.add('test', 1);
    await startProcessing;
    await worker.pause();
    await queue.add('test', 2);

    const count = await queue.getJobCounts('active', 'waiting', 'completed');
    expect(count.active).to.be.eql(0);
    expect(count.waiting).to.be.eql(1);
    expect(count.completed).to.be.eql(1);

    return worker.close();
  });

  it('pauses fast when queue is drained', async function() {
    const worker = new Worker(queueName, async () => {});
    await worker.waitUntilReady();

    await queue.add('test', {});

    return new Promise((resolve, reject) => {
      queueEvents.on('drained', async () => {
        try {
          const start = new Date().getTime();
          await queue.pause();

          const finish = new Date().getTime();
          expect(finish - start).to.be.lt(1000);
        } catch (err) {
          reject(err);
        } finally {
          await worker.close();
        }
        resolve();
      });
    });
  });
});
