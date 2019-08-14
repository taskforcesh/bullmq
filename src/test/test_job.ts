/*eslint-env node */
'use strict';

import { Job, Queue, QueueScheduler } from '@src/classes';
import { describe, beforeEach, afterEach, it } from 'mocha';
import { expect } from 'chai';
import IORedis from 'ioredis';
import { v4 } from 'node-uuid';
import { JobsOpts } from '@src/interfaces';
import { QueueEvents } from '@src/classes/queue-events';
import { Worker } from '@src/classes/worker';

import { delay } from 'bluebird';

describe('Job', function() {
  let queue: Queue;
  let queueName: string;
  let client: IORedis.Redis;

  beforeEach(function() {
    client = new IORedis();
    return client.flushdb();
  });

  beforeEach(function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName, {
      connection: { port: 6379, host: '127.0.0.1' },
    });
  });

  afterEach(function() {
    return queue.close().then(function() {
      return client.quit();
    });
  });

  describe('.create', function() {
    const timestamp = 1234567890;
    let job: Job;
    let data: any;
    let opts: JobsOpts;

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

  describe('.update', function() {
    it('should allow updating job data', async function() {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
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
      expect(storedJob).to.be.equal(null);
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
      const job1Id = await job2.moveToCompleted('succeeded', true);
      const isJob2Completed = await job2.isCompleted();
      expect(isJob2Completed).to.be.equal(true);
      expect(job2.returnvalue).to.be.equal('succeeded');
      expect(job1Id[1]).to.be.equal(job1.id);
    });
  });

  describe('.moveToFailed', function() {
    it('marks the job as failed', async function() {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.equal(false);
      await job.moveToFailed(new Error('test error'), true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.equal(true);
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.be.equal(1);
    });

    it('moves the job to wait for retry if attempts are given', async function() {
      const queueEvents = new QueueEvents(queueName);
      await queueEvents.init();

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

      await job.moveToFailed(new Error('test error'), true);

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
      await job.moveToFailed(new Error('test error'), true);
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
      await job.moveToFailed(new Error('test error'), true);
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
      await job.moveToFailed(new Error('test error'), true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.equal(true);
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.be.equal(stackTraceLimit);
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
      await queueScheduler.init();

      this.timeout(10000);
      const worker = new Worker(queueName, job => {
        return delay(100);
      });
      await worker.waitUntilReady();

      const completed: string[] = [];

      const done = new Promise(resolve => {
        worker.on('completed', job => {
          completed.push(job.id);
          if (completed.length > 3) {
            expect(completed).to.be.eql(['1', '2', '3', '4']);
            resolve();
          }
        });
      });

      const processStarted = new Promise(resolve =>
        worker.once('active', resolve),
      );

      const add = (jobId: string, ms = 0) =>
        queue.append('test', {}, { jobId, delay: ms, priority: 1 });

      await add('1');
      await add('2', 1);
      await processStarted;
      const job = await add('3', 5000);
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
      return queueEvents.init();
    });

    afterEach(async function() {
      await queueEvents.close();
    });

    it('should resolve when the job has been completed', async function() {
      const worker = new Worker(queueName, async job => 'qux');

      const job = await queue.append('test', { foo: 'bar' });

      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.be.equal('qux');

      await worker.close();
    });

    it('should resolve when the job has been completed and return object', async function() {
      const worker = new Worker(queueName, async job => ({ resultFoo: 'bar' }));

      const job = await queue.append('test', { foo: 'bar' });

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

      const job = await queue.append('test', { foo: 'bar' });
      await delay(600);

      const result = await job.waitUntilFinished(queueEvents);
      expect(result).to.be.an('object');
      expect(result.resultFoo).equal('bar');

      await worker.close();
    });

    it('should resolve when the job has been completed and return string', async function() {
      const worker = new Worker(queueName, async job => 'a string');

      const job = await queue.append('test', { foo: 'bar' });

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

      const job = await queue.append('test', { foo: 'bar' });

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

      const job = await queue.append('test', { foo: 'bar' });

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

      const job = await queue.append('test', { foo: 'bar' });

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
