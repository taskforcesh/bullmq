/*eslint-env node */
'use strict';

import { Job, Queue, QueueScheduler } from '@src/classes';
import { QueueEvents } from '@src/classes/queue-events';
import { Worker } from '@src/classes/worker';
import { JobsOptions } from '@src/interfaces';
import { delay, removeAllQueueData } from '@src/utils';
import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { after } from 'lodash';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';

describe('Job', function() {
  let queue: Queue;
  let queueName: string;

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
  });

  afterEach(async () => {
    await queue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  describe('.create', function() {
    const timestamp = 1234567890;
    let job: Job;
    let data: any;
    let opts: JobsOptions;

    beforeEach(async function() {
      data = { foo: 'bar' };
      opts = { timestamp };

      const createdJob = await Job.create(queue, 'test', data, opts);
      job = createdJob;
    });

    it('saves the job in redis', async function() {
      const storedJob = await Job.fromId(queue, job.id);
      expect(storedJob).to.have.property('id');
      expect(storedJob).to.have.property('data');

      expect(storedJob.data.foo).to.be.equal('bar');
      expect(storedJob.opts).to.be.an('object');
      expect(storedJob.opts.timestamp).to.be.equal(timestamp);
    });

    it('should use the custom jobId if one is provided', async function() {
      const customJobId = 'customjob';
      const createdJob = await Job.create(queue, 'test', data, {
        jobId: customJobId,
      });
      expect(createdJob.id).to.be.equal(customJobId);
    });
  });

  describe('JSON.stringify', () => {
    it('retains property types', async () => {
      const data = { foo: 'bar' };
      const job = await Job.create(queue, 'test', data);
      job.returnvalue = 1;
      job.progress = 20;
      const json = JSON.stringify(job);
      const parsed = JSON.parse(json);
      expect(parsed).to.have.deep.property('data', data);
      expect(parsed).to.have.property('name', 'test');
      expect(parsed).to.have.property('returnvalue', 1);
      expect(parsed).to.have.property('progress', 20);
    });

    it('omits the queue property to avoid a circular json error on node 8', async () => {
      const data = { foo: 'bar' };
      const job = await Job.create(queue, 'test', data);
      const json = JSON.stringify(job);
      const parsed = JSON.parse(json);
      expect(parsed).not.to.have.property('queue');
    });

    it('should correctly handle zero passed as data', async () => {
      const data = 0;
      const job = await Job.create(queue, 'test', data);
      const json = JSON.stringify(job);
      const parsed = JSON.parse(json);
      expect(parsed).to.have.deep.property('data', data);

      const newQueue = new Queue(queueName);
      let worker: Worker;
      const promise = new Promise<void>(async (resolve, reject) => {
        worker = new Worker(queueName, async job => {
          try {
            expect(job.data).to.be.equal(0);
          } catch (err) {
            reject(err);
          }
          resolve();
        });
        const testJob = await newQueue.add('test', 0);
      });

      try {
        await promise;
      } finally {
        await newQueue.close();
        worker && (await worker.close());
      }
    });
  });

  describe('.update', function() {
    it('should allow updating job data', async function() {
      const job = await Job.create<{ foo?: string; baz?: string }>(
        queue,
        'test',
        { foo: 'bar' },
      );
      await job.update({ baz: 'qux' });

      const updatedJob = await Job.fromId(queue, job.id);
      expect(updatedJob.data).to.be.eql({ baz: 'qux' });
    });
  });

  describe('.remove', function() {
    it('removes the job from redis', async function() {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      await job.remove();
      const storedJob = await Job.fromId(queue, job.id);
      expect(storedJob).to.be.equal(undefined);
    });
  });

  describe('.progress', function() {
    it('can set and get progress as number', async function() {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      await job.updateProgress(42);
      const storedJob = await Job.fromId(queue, job.id);
      expect(storedJob.progress).to.be.equal(42);
    });

    it('can set and get progress as object', async function() {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      await job.updateProgress({ total: 120, completed: 40 });
      const storedJob = await Job.fromId(queue, job.id);
      expect(storedJob.progress).to.eql({ total: 120, completed: 40 });
    });
  });

  describe('.log', () => {
    it('can log two rows with text', async () => {
      const firstLog = 'some log text 1';
      const secondLog = 'some log text 2';

      const job = await Job.create(queue, 'test', { foo: 'bar' });

      await job.log(firstLog);
      await job.log(secondLog);
      const logs = await queue.getJobLogs(job.id);
      expect(logs).to.be.eql({ logs: [firstLog, secondLog], count: 2 });
      await job.remove();

      const logsRemoved = await queue.getJobLogs(job.id);
      expect(logsRemoved).to.be.eql({ logs: [], count: 0 });
    });
  });

  describe('.moveToCompleted', function() {
    it('marks the job as completed and returns new job', async function() {
      const job1 = await Job.create(queue, 'test', { foo: 'bar' });
      const job2 = await Job.create(queue, 'test', { baz: 'qux' });
      const isCompleted = await job2.isCompleted();
      expect(isCompleted).to.be.equal(false);
      const job1Id = await job2.moveToCompleted('succeeded', '0', true);
      const isJob2Completed = await job2.isCompleted();
      expect(isJob2Completed).to.be.equal(true);
      expect(job2.returnvalue).to.be.equal('succeeded');
      expect(job1Id[1]).to.be.equal(job1.id);
    });

    /**
     * Verify moveToFinished use default value for opts.maxLenEvents
     * if it does not exist in meta key (or entire meta key is missing).
     */
    it('should not fail if queue meta key is missing', async function() {
      const job = await queue.add('test', { color: 'red' });
      const client = await queue.client;
      await client.del(queue.toKey('meta'));
      await job.moveToCompleted('done', '0', false);
    });
  });

  describe('.moveToFailed', function() {
    it('marks the job as failed', async function() {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.equal(false);
      await job.moveToFailed(new Error('test error'), '0', true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.equal(true);
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.be.equal(1);
    });

    it('moves the job to wait for retry if attempts are given', async function() {
      const queueEvents = new QueueEvents(queueName);
      await queueEvents.waitUntilReady();

      const job = await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { attempts: 3 },
      );
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.equal(false);

      const waiting = new Promise(resolve => {
        queueEvents.on('waiting', resolve);
      });

      await job.moveToFailed(new Error('test error'), '0', true);

      await waiting;

      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.equal(false);
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.be.equal(1);
      const isWaiting = await job.isWaiting();
      expect(isWaiting).to.be.equal(true);

      await queueEvents.close();
    });

    it('marks the job as failed when attempts made equal to attempts given', async function() {
      const job = await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { attempts: 1 },
      );
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.equal(false);
      await job.moveToFailed(new Error('test error'), '0', true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.equal(true);
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.be.equal(1);
    });

    it('moves the job to delayed for retry if attempts are given and backoff is non zero', async function() {
      const job = await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { attempts: 3, backoff: 300 },
      );
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.equal(false);
      await job.moveToFailed(new Error('test error'), '0', true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.equal(false);
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.be.equal(1);
      const isDelayed = await job.isDelayed();
      expect(isDelayed).to.be.equal(true);
    });

    it('applies stacktrace limit on failure', async function() {
      const stackTraceLimit = 1;
      const job = await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { stackTraceLimit: stackTraceLimit },
      );
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.equal(false);
      await job.moveToFailed(new Error('test error'), '0', true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.equal(true);
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.be.equal(stackTraceLimit);
    });

    it('saves error stacktrace', async function() {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      const id = job.id;
      await job.moveToFailed(new Error('test error'), '0');
      const sameJob = await queue.getJob(id);
      expect(sameJob).to.be.ok;
      expect(sameJob.stacktrace).to.be.not.empty;
    });
  });

  describe('.promote', () => {
    it('can promote a delayed job to be executed immediately', async () => {
      const job = await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { delay: 1500 },
      );
      const isDelayed = await job.isDelayed();
      expect(isDelayed).to.be.equal(true);
      await job.promote();

      const isDelayedAfterPromote = await job.isDelayed();
      expect(isDelayedAfterPromote).to.be.equal(false);
      const isWaiting = await job.isWaiting();
      expect(isWaiting).to.be.equal(true);
    });

    it('should process a promoted job according to its priority', async function() {
      const queueScheduler = new QueueScheduler(queueName);
      await queueScheduler.waitUntilReady();

      this.timeout(10000);
      const worker = new Worker(queueName, job => {
        return delay(100);
      });
      await worker.waitUntilReady();

      const completed: string[] = [];

      const done = new Promise<void>(resolve => {
        worker.on('completed', job => {
          completed.push(job.id);
          if (completed.length > 3) {
            expect(completed).to.be.eql(['1', '2', '3', '4']);
            resolve();
          }
        });
      });

      const processStarted = new Promise(resolve =>
        worker.on('active', after(2, resolve)),
      );

      const add = (jobId: string, ms = 0) =>
        queue.add('test', {}, { jobId, delay: ms, priority: 1 });

      await add('1');
      await add('2', 1);
      await processStarted;
      const job = await add('3', 2000);

      await job.promote();
      await add('4', 1);

      await done;

      await queueScheduler.close();
    });

    it('should not promote a job that is not delayed', async () => {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      const isDelayed = await job.isDelayed();
      expect(isDelayed).to.be.equal(false);

      try {
        await job.promote();
        throw new Error('Job should not be promoted!');
      } catch (err) {}
    });

    it('should promote delayed job to the right queue if queue is paused', async () => {
      const normalJob = await queue.add('normal', { foo: 'bar' });
      const delayedJob = await queue.add(
        'delayed',
        { foo: 'bar' },
        { delay: 1 },
      );

      await queue.pause();
      await delayedJob.promote();
      await queue.resume();

      const waitingJobsCount = await queue.getWaitingCount();
      expect(waitingJobsCount).to.be.equal(2);
      const delayedJobsNewState = await delayedJob.getState();
      expect(delayedJobsNewState).to.be.equal('waiting');
    });
  });

  // TODO:
  // Divide into several tests
  //
  /*
  const scripts = require('../lib/scripts');
  it('get job status', function() {
    this.timeout(12000);

    const client = new redis();
    return Job.create(queue, { foo: 'baz' })
      .then(job => {
        return job
          .isStuck()
          .then(isStuck => {
            expect(isStuck).to.be(false);
            return job.getState();
          })
          .then(state => {
            expect(state).to.be('waiting');
            return scripts.moveToActive(queue).then(() => {
              return job.moveToCompleted();
            });
          })
          .then(() => {
            return job.isCompleted();
          })
          .then(isCompleted => {
            expect(isCompleted).to.be(true);
            return job.getState();
          })
          .then(state => {
            expect(state).to.be('completed');
            return client.zrem(queue.toKey('completed'), job.id);
          })
          .then(() => {
            return job.moveToDelayed(Date.now() + 10000, true);
          })
          .then(() => {
            return job.isDelayed();
          })
          .then(yes => {
            expect(yes).to.be(true);
            return job.getState();
          })
          .then(state => {
            expect(state).to.be('delayed');
            return client.zrem(queue.toKey('delayed'), job.id);
          })
          .then(() => {
            return job.moveToFailed(new Error('test'), true);
          })
          .then(() => {
            return job.isFailed();
          })
          .then(isFailed => {
            expect(isFailed).to.be(true);
            return job.getState();
          })
          .then(state => {
            expect(state).to.be('failed');
            return client.zrem(queue.toKey('failed'), job.id);
          })
          .then(res => {
            expect(res).to.be(1);
            return job.getState();
          })
          .then(state => {
            expect(state).to.be('stuck');
            return client.rpop(queue.toKey('wait'));
          })
          .then(() => {
            return client.lpush(queue.toKey('paused'), job.id);
          })
          .then(() => {
            return job.isPaused();
          })
          .then(isPaused => {
            expect(isPaused).to.be(true);
            return job.getState();
          })
          .then(state => {
            expect(state).to.be('paused');
            return client.rpop(queue.toKey('paused'));
          })
          .then(() => {
            return client.lpush(queue.toKey('wait'), job.id);
          })
          .then(() => {
            return job.isWaiting();
          })
          .then(isWaiting => {
            expect(isWaiting).to.be(true);
            return job.getState();
          })
          .then(state => {
            expect(state).to.be('waiting');
          });
      })
      .then(() => {
        return client.quit();
      });
  });
  */

  describe('.finished', function() {
    let queueEvents: QueueEvents;

    beforeEach(async function() {
      queueEvents = new QueueEvents(queueName);
      await queueEvents.waitUntilReady();
    });

    afterEach(async function() {
      await queueEvents.close();
    });

    it('should resolve when the job has been completed', async function() {
      const worker = new Worker(queueName, async job => 'qux');

      const job = await queue.add('test', { foo: 'bar' });

      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.be.equal('qux');

      await worker.close();
    });

    it('should resolve when the job has been completed and return object', async function() {
      const worker = new Worker(queueName, async job => ({ resultFoo: 'bar' }));

      const job = await queue.add('test', { foo: 'bar' });

      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.be.an('object');
      expect(result.resultFoo).equal('bar');

      await worker.close();
    });

    it('should resolve when the job has been delayed and completed and return object', async function() {
      const worker = new Worker(queueName, async job => {
        await delay(300);
        return { resultFoo: 'bar' };
      });

      const job = await queue.add('test', { foo: 'bar' });
      await delay(600);

      const result = await job.waitUntilFinished(queueEvents);
      expect(result).to.be.an('object');
      expect(result.resultFoo).equal('bar');

      await worker.close();
    });

    it('should resolve when the job has been completed and return string', async function() {
      const worker = new Worker(queueName, async job => 'a string');

      const job = await queue.add('test', { foo: 'bar' });

      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.be.an('string');
      expect(result).equal('a string');

      await worker.close();
    });

    it('should reject when the job has been failed', async function() {
      const worker = new Worker(queueName, async job => {
        await delay(500);
        throw new Error('test error');
      });

      const job = await queue.add('test', { foo: 'bar' });

      try {
        await job.waitUntilFinished(queueEvents);
        throw new Error('should have been rejected');
      } catch (err) {
        expect(err.message).equal('test error');
      }

      await worker.close();
    });

    it('should resolve directly if already processed', async function() {
      const worker = new Worker(queueName, async job => ({ resultFoo: 'bar' }));

      const job = await queue.add('test', { foo: 'bar' });

      await delay(500);
      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.be.an('object');
      expect(result.resultFoo).equal('bar');

      await worker.close();
    });

    it('should reject directly if already processed', async function() {
      const worker = new Worker(queueName, async job => {
        throw new Error('test error');
      });

      const job = await queue.add('test', { foo: 'bar' });

      await delay(500);
      try {
        await job.waitUntilFinished(queueEvents);
        throw new Error('should have been rejected');
      } catch (err) {
        expect(err.message).equal('test error');
      }

      await worker.close();
    });
  });
});
