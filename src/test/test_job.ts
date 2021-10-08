/*eslint-env node */
'use strict';

import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { after } from 'lodash';
import { afterEach, beforeEach, describe, it } from 'mocha';
import * as sinon from 'sinon';
import { v4 } from 'uuid';
import { Job, Queue, QueueScheduler, QueueEvents, Worker } from '../classes';
import { JobsOptions } from '../interfaces';
import { delay, getParentKey, removeAllQueueData } from '../utils';

const ONE_SECOND = 1000;

describe('Job', function() {
  let queue: Queue;
  let queueName: string;

  beforeEach(async function() {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName);
  });

  afterEach(async function() {
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

    it('should set default size limit and succeed in creating job', async () => {
      const data = { foo: 'bar' }; // 13 bytes
      const opts = { sizeLimit: 20 };
      const createdJob = await Job.create(queue, 'test', data, opts);
      expect(createdJob).to.not.be.null;
      expect(createdJob).to.have.property('opts');
      expect(createdJob.opts.sizeLimit).to.be.equal(20);
    });

    it('should set default size limit and fail due to size limit exception', async () => {
      const data = { foo: 'bar' }; // 13 bytes
      const opts = { sizeLimit: 12 };
      await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
        `The size of job test exceeds the limit ${opts.sizeLimit} bytes`,
      );
    });

    it('should set default size limit with non-ascii data and fail due to size limit exception', async () => {
      const data = { foo: 'βÅ®' }; // 16 bytes
      const opts = { sizeLimit: 15 };
      await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
        `The size of job test exceeds the limit ${opts.sizeLimit} bytes`,
      );
    });

    it('should set custom job id and default size limit and fail due to size limit exception', async () => {
      const data = { foo: 'bar' }; // 13 bytes
      const opts = { sizeLimit: 12, jobId: 'customJobId' };
      await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
        `The size of job test exceeds the limit ${opts.sizeLimit} bytes`,
      );
    });

    describe('when parent key is missing', () => {
      it('throws an error', async () => {
        const data = { foo: 'bar' };
        const parentId = v4();
        const opts = { parent: { id: parentId, queue: queueName } };
        await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
          `Missing key for parent job ${queueName}:${parentId}. addJob`,
        );
      });
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

    it('removes processed hash', async function() {
      const client = await queue.client;
      const values = [{ idx: 0, bar: 'something' }];
      const token = 'my-token';
      const token2 = 'my-token2';
      const parentQueueName = `parent-queue-${v4()}`;

      const parentQueue = new Queue(parentQueueName);
      const parentWorker = new Worker(parentQueueName);
      const childrenWorker = new Worker(queueName);
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const data = { foo: 'bar' };
      const parent = await Job.create(parentQueue, 'testParent', data);
      await Job.create(queue, 'testJob1', values[0], {
        parent: { id: parent.id, queue: `bull:${parentQueueName}` },
      });

      const job = (await parentWorker.getNextJob(token)) as Job;
      const child1 = (await childrenWorker.getNextJob(token2)) as Job;

      const isActive = await job.isActive();
      expect(isActive).to.be.equal(true);

      await child1.moveToCompleted('return value', token2);

      const parentId = job.id;
      await job.moveToCompleted('return value', token);
      await job.remove();

      const storedJob = await Job.fromId(parentQueue, job.id);
      expect(storedJob).to.be.equal(undefined);

      const processed = await client.hgetall(
        `bull:${parentQueueName}:${parentId}:processed`,
      );

      expect(processed).to.deep.equal({});

      await childrenWorker.close();
      await parentWorker.close();
      await parentQueue.close();
      await removeAllQueueData(new IORedis(), parentQueueName);
    });
  });

  // TODO: Add more remove tests

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
    it('can log two rows with text in asc order', async () => {
      const firstLog = 'some log text 1';
      const secondLog = 'some log text 2';

      const job = await Job.create(queue, 'test', { foo: 'bar' });

      await job.log(firstLog);
      await job.log(secondLog);
      const logs = await queue.getJobLogs(job.id);
      expect(logs).to.be.eql({ logs: [firstLog, secondLog], count: 2 });
      const firstSavedLog = await queue.getJobLogs(job.id, 0, 0, true);
      expect(firstSavedLog).to.be.eql({ logs: [firstLog], count: 2 });
      const secondSavedLog = await queue.getJobLogs(job.id, 1, 1);
      expect(secondSavedLog).to.be.eql({ logs: [secondLog], count: 2 });
      await job.remove();

      const logsRemoved = await queue.getJobLogs(job.id);
      expect(logsRemoved).to.be.eql({ logs: [], count: 0 });
    });

    it('can log two rows with text in desc order', async () => {
      const firstLog = 'some log text 1';
      const secondLog = 'some log text 2';

      const job = await Job.create(queue, 'test', { foo: 'bar' });

      await job.log(firstLog);
      await job.log(secondLog);
      const logs = await queue.getJobLogs(job.id, 0, -1, false);
      expect(logs).to.be.eql({ logs: [secondLog, firstLog], count: 2 });
      const secondSavedLog = await queue.getJobLogs(job.id, 0, 0, false);
      expect(secondSavedLog).to.be.eql({ logs: [secondLog], count: 2 });
      const firstSavedLog = await queue.getJobLogs(job.id, 1, 1, false);
      expect(firstSavedLog).to.be.eql({ logs: [firstLog], count: 2 });
      await job.remove();

      const logsRemoved = await queue.getJobLogs(job.id);
      expect(logsRemoved).to.be.eql({ logs: [], count: 0 });
    });
  });

  describe('.moveToCompleted', function() {
    it('marks the job as completed and returns new job', async function() {
      const worker = new Worker(queueName);
      const token = 'my-token';
      await Job.create(queue, 'test', { foo: 'bar' });
      const job2 = await Job.create(queue, 'test', { baz: 'qux' });
      const job1 = (await worker.getNextJob(token)) as Job;
      const isCompleted = await job1.isCompleted();
      expect(isCompleted).to.be.equal(false);
      const state = await job1.getState();
      expect(state).to.be.equal('active');
      const job1Id = await job1.moveToCompleted('succeeded', token, true);
      const isJob1Completed = await job1.isCompleted();
      expect(isJob1Completed).to.be.equal(true);
      expect(job1.returnvalue).to.be.equal('succeeded');
      expect(job1Id[1]).to.be.equal(job2.id);
      await worker.close();
    });

    /**
     * Verify moveToFinished use default value for opts.maxLenEvents
     * if it does not exist in meta key (or entire meta key is missing).
     */
    it('should not fail if queue meta key is missing', async function() {
      const worker = new Worker(queueName);
      const token = 'my-token';
      await Job.create(queue, 'test', { color: 'red' });
      const job = (await worker.getNextJob(token)) as Job;
      const client = await queue.client;
      await client.del(queue.toKey('meta'));
      await job.moveToCompleted('done', '0', false);
      const state = await job.getState();
      expect(state).to.be.equal('completed');
      await worker.close();
    });

    it('should not complete a parent job before its children', async () => {
      const values = [
        { idx: 0, bar: 'something' },
        { idx: 1, baz: 'something' },
      ];
      const token = 'my-token';

      const parentQueueName = `parent-queue-${v4()}`;

      const parentQueue = new Queue(parentQueueName);

      const parentWorker = new Worker(parentQueueName);
      const childrenWorker = new Worker(queueName);
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const data = { foo: 'bar' };
      const parent = await Job.create(parentQueue, 'testParent', data);
      const parentKey = getParentKey({
        id: parent.id,
        queue: 'bull:' + parentQueueName,
      });
      const client = await queue.client;
      const child1 = new Job(queue, 'testJob1', values[0]);
      await child1.addJob(client, {
        parentKey,
        parentDependenciesKey: `${parentKey}:dependencies`,
      });
      await Job.create(queue, 'testJob2', values[1], {
        parent: {
          id: parent.id,
          queue: 'bull:' + parentQueueName,
        },
      });

      const job = (await parentWorker.getNextJob(token)) as Job;
      const { unprocessed } = await parent.getDependencies();

      expect(unprocessed).to.have.length(2);

      const isActive = await job.isActive();
      expect(isActive).to.be.equal(true);

      await expect(
        job.moveToCompleted('return value', token),
      ).to.be.rejectedWith(`Job ${job.id} has pending dependencies. finished`);

      const isCompleted = await job.isCompleted();

      expect(isCompleted).to.be.false;

      await childrenWorker.close();
      await parentWorker.close();
      await parentQueue.close();
      await removeAllQueueData(new IORedis(), parentQueueName);
    });
  });

  describe('.moveToFailed', function() {
    it('marks the job as failed', async function() {
      const worker = new Worker(queueName);
      const token = 'my-token';
      await Job.create(queue, 'test', { foo: 'bar' });
      const job = (await worker.getNextJob(token)) as Job;
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.equal(false);
      await job.moveToFailed(new Error('test error'), '0', true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.equal(true);
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.be.equal(1);
      await worker.close();
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
      const worker = new Worker(queueName);
      const token = 'my-token';
      await Job.create(queue, 'test', { foo: 'bar' }, { attempts: 1 });
      const job = (await worker.getNextJob(token)) as Job;
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.equal(false);
      await job.moveToFailed(new Error('test error'), '0', true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.equal(true);
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.be.equal(1);
      await worker.close();
    });

    it('moves the job to delayed for retry if attempts are given and backoff is non zero', async function() {
      const worker = new Worker(queueName);
      const token = 'my-token';
      await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { attempts: 3, backoff: 300 },
      );
      const job = (await worker.getNextJob(token)) as Job;
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.equal(false);
      await job.moveToFailed(new Error('test error'), token, true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.equal(false);
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.be.equal(1);
      const isDelayed = await job.isDelayed();
      expect(isDelayed).to.be.equal(true);
      await worker.close();
    });

    it('applies stacktrace limit on failure', async function() {
      const worker = new Worker(queueName);
      const token = 'my-token';
      const stackTraceLimit = 1;
      await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { stackTraceLimit: stackTraceLimit },
      );
      const job = (await worker.getNextJob(token)) as Job;
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.equal(false);
      await job.moveToFailed(new Error('test error'), '0', true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.equal(true);
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.be.equal(stackTraceLimit);
      await worker.close();
    });

    it('saves error stacktrace', async function() {
      const worker = new Worker(queueName);
      const token = 'my-token';
      await Job.create(queue, 'test', { foo: 'bar' });
      const job = (await worker.getNextJob(token)) as Job;
      const id = job.id;
      await job.moveToFailed(new Error('test error'), '0');
      const sameJob = await queue.getJob(id);
      expect(sameJob).to.be.ok;
      expect(sameJob.stacktrace).to.be.not.empty;
      await worker.close();
    });
  });

  describe('.changeDelay', () => {
    it('can change delay of a delayed job', async function() {
      this.timeout(8000);

      const queueScheduler = new QueueScheduler(queueName);
      await queueScheduler.waitUntilReady();

      const worker = new Worker(queueName, async job => {});
      await worker.waitUntilReady();

      const startTime = new Date().getTime();

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async () => {
          const timeDiff = new Date().getTime() - startTime;
          expect(timeDiff).to.be.gte(4000);
          resolve();
        });
      });

      const job = await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { delay: 2000 },
      );

      const isDelayed = await job.isDelayed();
      expect(isDelayed).to.be.equal(true);

      await job.changeDelay(4000);

      const isDelayedAfterChangeDelay = await job.isDelayed();
      expect(isDelayedAfterChangeDelay).to.be.equal(true);

      await completing;

      await queueScheduler.close();
      await worker.close();
    });

    it('should not change delay if a job is not delayed', async () => {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      const isDelayed = await job.isDelayed();
      expect(isDelayed).to.be.equal(false);

      await expect(job.changeDelay(2000)).to.be.rejectedWith(
        `Job ${job.id} is not in the delayed state. changeDelay`,
      );
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

      await expect(job.promote()).to.be.rejectedWith(
        `Job ${job.id} is not in the delayed state. promote`,
      );
    });

    it('should promote delayed job to the right queue if queue is paused', async () => {
      await queue.add('normal', { foo: 'bar' });
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

  describe('.getState', () => {
    describe('when redisVersion is less than 6.0.6', () => {
      it('should get job actual state', async () => {
        const redisVersionStub = sinon
          .stub(queue, 'redisVersion')
          .get(() => '6.0.5');
        const worker = new Worker(queueName);
        const token = 'my-token';
        const job = await queue.add('job1', { foo: 'bar' }, { delay: 1 });
        const delayedState = await job.getState();

        expect(delayedState).to.be.equal('delayed');

        await queue.pause();
        await job.promote();
        await queue.resume();
        const waitingState = await job.getState();

        expect(waitingState).to.be.equal('waiting');

        const currentJob1 = (await worker.getNextJob(token)) as Job;

        await currentJob1.moveToFailed(new Error('test error'), token, true);
        const failedState = await currentJob1.getState();
        await queue.add('job2', { foo: 'foo' });
        const job2 = (await worker.getNextJob(token)) as Job;

        expect(failedState).to.be.equal('failed');

        await job2.moveToCompleted('succeeded', token, true);
        const completedState = await job2.getState();

        expect(completedState).to.be.equal('completed');
        await worker.close();
        redisVersionStub.restore();
      });
    });

    describe('when redisVersion is greater or equal than 6.0.6', () => {
      it('should get job actual state', async () => {
        const redisVersionStub = sinon
          .stub(queue, 'redisVersion')
          .get(() => '6.0.6');
        const worker = new Worker(queueName);
        const token = 'my-token';
        const job = await queue.add('job1', { foo: 'bar' }, { delay: 1 });
        const delayedState = await job.getState();

        expect(delayedState).to.be.equal('delayed');

        await queue.pause();
        await job.promote();
        await queue.resume();
        const waitingState = await job.getState();

        expect(waitingState).to.be.equal('waiting');

        const currentJob1 = (await worker.getNextJob(token)) as Job;

        await currentJob1.moveToFailed(new Error('test error'), token, true);
        const failedState = await currentJob1.getState();
        await queue.add('job2', { foo: 'foo' });
        const job2 = (await worker.getNextJob(token)) as Job;

        expect(failedState).to.be.equal('failed');

        await job2.moveToCompleted('succeeded', token, true);
        const completedState = await job2.getState();

        expect(completedState).to.be.equal('completed');
        await worker.close();
        redisVersionStub.restore();
      });
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

    describe('when job was added with removeOnComplete', async () => {
      it('rejects with missing key for job message', async function() {
        const worker = new Worker(queueName, async job => 'qux');
        await worker.waitUntilReady();

        const completed = new Promise<void>((resolve, reject) => {
          worker.on('completed', async (job: Job) => {
            try {
              const gotJob = await queue.getJob(job.id);
              expect(gotJob).to.be.equal(undefined);
              const counts = await queue.getJobCounts('completed');
              expect(counts.completed).to.be.equal(0);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        const job = await queue.add(
          'test',
          { foo: 'bar' },
          { removeOnComplete: true },
        );

        await completed;

        await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
          `Missing key for job ${queue.toKey(job.id)}. isFinished`,
        );

        await worker.close();
      });
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

      await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
        'test error',
      );

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
