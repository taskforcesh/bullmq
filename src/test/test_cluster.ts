import { Queue, Job, getParentKey } from '@src/classes';
import { describe, beforeEach, it, afterEach } from 'mocha';
import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { v4 } from 'uuid';
import { Worker } from '@src/classes/worker';
import { QueueEvents } from '@src/classes/queue-events';
import { QueueScheduler } from '@src/classes/queue-scheduler';
import { delay, removeAllQueueData } from '@src/utils';
import { JobsOptions, QueueBaseOptions } from '../interfaces';
import { after } from 'lodash';
import sinon = require('sinon');

describe('Cluster', function() {
  this.timeout(15000);

  let queue: Queue;
  let queueName: string;
  const queueOptions: () => QueueBaseOptions = () => {
    return {
      connection: new IORedis.Cluster([
        { host: 'localhost', port: 7000 },
        { host: 'localhost', port: 7001 },
        { host: 'localhost', port: 7002 },
        { host: 'localhost', port: 7003 },
        { host: 'localhost', port: 7004 },
      ]),
      prefix: '{bmq}',
    };
  };

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName, queueOptions());
  });

  afterEach(async function() {
    await queue.close();
    await removeAllQueueData(
      queueOptions().connection as any,
      queueName,
      queue.opts.prefix,
    );
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

      expect(storedJob.data.foo).to.eq('bar');
      expect(storedJob.opts).to.be.an('object');
      expect(storedJob.opts.timestamp).to.eq(timestamp);
    });

    it('should use the custom jobId if one is provided', async function() {
      const customJobId = 'customjob';
      const createdJob = await Job.create(queue, 'test', data, {
        jobId: customJobId,
      });
      expect(createdJob.id).to.eq(customJobId);
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

      const newQueue = new Queue(queueName, queueOptions());
      let worker: Worker;
      const promise = new Promise<void>(async (resolve, reject) => {
        worker = new Worker(
          queueName,
          async job => {
            try {
              expect(job.data).to.eq(0);
            } catch (err) {
              reject(err);
            }
            resolve();
          },
          queue.opts,
        );
        await newQueue.add('test', 0);
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
      expect(storedJob).to.eq(undefined);
    });
  });

  // TODO: Add more remove tests

  describe('.progress', function() {
    it('can set and get progress as number', async function() {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      await job.updateProgress(42);
      const storedJob = await Job.fromId(queue, job.id);
      expect(storedJob.progress).to.eq(42);
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
      const worker = new Worker(queueName, undefined, queueOptions());
      const token = 'my-token';
      await Job.create(queue, 'test', { foo: 'bar' });
      const job2 = await Job.create(queue, 'test', { baz: 'qux' });
      const job1 = (await worker.getNextJob(token)) as Job;
      const isCompleted = await job1.isCompleted();
      expect(isCompleted).to.be.false;
      const state = await job1.getState();
      expect(state).to.eq('active');
      const job1Id = await job1.moveToCompleted('succeeded', token, true);
      const isJob1Completed = await job1.isCompleted();
      expect(isJob1Completed).to.be.true;
      expect(job1.returnvalue).to.eq('succeeded');
      expect(job1Id[1]).to.eq(job2.id);
      await worker.close();
    });

    /**
     * Verify moveToFinished use default value for opts.maxLenEvents
     * if it does not exist in meta key (or entire meta key is missing).
     */
    it('should not fail if queue meta key is missing', async function() {
      const worker = new Worker(queueName, undefined, queueOptions());
      const token = 'my-token';
      await Job.create(queue, 'test', { color: 'red' });
      const job = (await worker.getNextJob(token)) as Job;
      const client = await queue.client;
      await client.del(queue.toKey('meta'));
      await job.moveToCompleted('done', '0', false);
      const state = await job.getState();
      expect(state).to.eq('completed');
      await worker.close();
    });

    it('should not complete a parent job before its children', async () => {
      const values = [
        { idx: 0, bar: 'something' },
        { idx: 1, baz: 'something' },
      ];
      const token = 'my-token';

      const parentQueueName = 'parent-queue';
      const parentQueue = new Queue(parentQueueName, queueOptions());
      const parentWorker = new Worker(
        parentQueueName,
        undefined,
        queueOptions(),
      );
      const childrenWorker = new Worker(queueName, undefined, queueOptions());
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const data = { foo: 'bar' };
      const parent = await Job.create(parentQueue, 'testParent', data);
      const parentKey = getParentKey({
        id: parent.id,
        queue: queue.opts.prefix + ':' + parentQueueName,
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
          queue: queue.opts.prefix + ':' + parentQueueName,
        },
      });

      const job = (await parentWorker.getNextJob(token)) as Job;
      const { unprocessed } = await parent.getDependencies();

      expect(unprocessed).to.have.length(2);

      const isActive = await job.isActive();
      expect(isActive).to.be.true;

      const err = await job
        .moveToCompleted('return value', token)
        .catch(e => e.message);
      expect(err).to.eq(`Job ${job.id} has pending dependencies finished`);

      const isCompleted = await job.isCompleted();

      expect(isCompleted).to.be.false;

      await childrenWorker.close();
      await parentWorker.close();
      await parentQueue.close();
      await removeAllQueueData(client, parentQueueName, queue.opts.prefix);
    });
  });

  describe('.moveToFailed', function() {
    it('marks the job as failed', async function() {
      const worker = new Worker(queueName, undefined, queueOptions());
      const token = 'my-token';
      await Job.create(queue, 'test', { foo: 'bar' });
      const job = (await worker.getNextJob(token)) as Job;
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.false;
      await job.moveToFailed(new Error('test error'), '0', true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.true;
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.eq(1);
      await worker.close();
    });

    it('moves the job to wait for retry if attempts are given', async function() {
      const queueEvents = new QueueEvents(queueName, queueOptions());
      await queueEvents.waitUntilReady();

      const job = await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { attempts: 3 },
      );

      const isFailed = await job.isFailed();
      expect(isFailed).to.be.false;

      const waiting = new Promise(resolve => {
        queueEvents.on('waiting', resolve);
      });

      await job.moveToFailed(new Error('test error'), '0', true);

      await waiting;

      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.false;
      expect(job.stacktrace).not.be.null;
      expect(job.stacktrace.length).to.eq(1);
      const isWaiting = await job.isWaiting();
      expect(isWaiting).to.be.true;

      await queueEvents.close();
    });

    it('marks the job as failed when attempts made equal to attempts given', async function() {
      const worker = new Worker(queueName, undefined, queueOptions());
      const token = 'my-token';
      await Job.create(queue, 'test', { foo: 'bar' }, { attempts: 1 });
      const job = (await worker.getNextJob(token)) as Job;
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.false;
      await job.moveToFailed(new Error('test error'), '0', true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.true;
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.eq(1);
      await worker.close();
    });

    it('moves the job to delayed for retry if attempts are given and backoff is non zero', async function() {
      const worker = new Worker(queueName, undefined, queueOptions());
      const token = 'my-token';
      await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { attempts: 3, backoff: 300 },
      );
      const job = await worker.getNextJob(token);
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.false;
      await job.moveToFailed(new Error('test error'), token, true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.false;
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.eq(1);
      const isDelayed = await job.isDelayed();
      expect(isDelayed).to.be.true;
      await worker.close();
    });

    it('applies stacktrace limit on failure', async function() {
      const worker = new Worker(queueName, undefined, queueOptions());
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
      expect(isFailed).to.be.false;
      await job.moveToFailed(new Error('test error'), '0', true);
      const isFailed2 = await job.isFailed();
      expect(isFailed2).to.be.true;
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.eq(stackTraceLimit);
      await worker.close();
    });

    it('saves error stacktrace', async function() {
      const worker = new Worker(queueName, undefined, queueOptions());
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

  describe('.promote', () => {
    it('can promote a delayed job to be executed immediately', async () => {
      const job = await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { delay: 1500 },
      );
      const isDelayed = await job.isDelayed();
      expect(isDelayed).to.be.true;
      await job.promote();

      const isDelayedAfterPromote = await job.isDelayed();
      expect(isDelayedAfterPromote).to.be.false;
      const isWaiting = await job.isWaiting();
      expect(isWaiting).to.be.true;
    });

    it('should process a promoted job according to its priority', async function() {
      const queueScheduler = new QueueScheduler(queueName, queueOptions());
      await queueScheduler.waitUntilReady();

      this.timeout(10000);
      const worker = new Worker(
        queueName,
        () => {
          return delay(100);
        },
        queue.opts,
      );
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
      expect(isDelayed).to.be.false;

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
      expect(waitingJobsCount).to.eq(2);
      const delayedJobsNewState = await delayedJob.getState();
      expect(delayedJobsNewState).to.eq('waiting');
    });
  });

  describe('.getState', () => {
    describe('when redisVersion is less than 6.0.6', () => {
      it('should get job actual state', async () => {
        const redisVersionStub = sinon
          .stub(queue, 'redisVersion')
          .get(() => '6.0.5');
        const worker = new Worker(queueName, undefined, queueOptions());
        const token = 'my-token';
        const job = await queue.add('job1', { foo: 'bar' }, { delay: 1 });
        const delayedState = await job.getState();

        expect(delayedState).to.eq('delayed');

        await queue.pause();
        await job.promote();
        await queue.resume();
        const waitingState = await job.getState();

        expect(waitingState).to.eq('waiting');

        const currentJob1 = (await worker.getNextJob(token)) as Job;

        await currentJob1.moveToFailed(new Error('test error'), token, true);
        const failedState = await currentJob1.getState();
        await queue.add('job2', { foo: 'foo' });
        const job2 = (await worker.getNextJob(token)) as Job;

        expect(failedState).to.eq('failed');

        await job2.moveToCompleted('succeeded', token, true);
        const completedState = await job2.getState();

        expect(completedState).to.eq('completed');
        await worker.close();
        redisVersionStub.restore();
      });
    });

    describe('when redisVersion is greater or equal than 6.0.6', () => {
      it('should get job actual state', async () => {
        const redisVersionStub = sinon
          .stub(queue, 'redisVersion')
          .get(() => '6.0.6');
        const worker = new Worker(queueName, undefined, queueOptions());
        const token = 'my-token';
        const job = await queue.add('job1', { foo: 'bar' }, { delay: 1 });
        const delayedState = await job.getState();

        expect(delayedState).to.eq('delayed');

        await queue.pause();
        await job.promote();
        await queue.resume();
        const waitingState = await job.getState();

        expect(waitingState).to.eq('waiting');

        const currentJob1 = (await worker.getNextJob(token)) as Job;

        await currentJob1.moveToFailed(new Error('test error'), token, true);
        const failedState = await currentJob1.getState();
        await queue.add('job2', { foo: 'foo' });
        const job2 = (await worker.getNextJob(token)) as Job;

        expect(failedState).to.eq('failed');

        await job2.moveToCompleted('succeeded', token, true);
        const completedState = await job2.getState();

        expect(completedState).to.eq('completed');
        await worker.close();
        redisVersionStub.restore();
      });
    });
  });

  describe('.finished', function() {
    let queueEvents: QueueEvents;

    beforeEach(async function() {
      queueEvents = new QueueEvents(queueName, queueOptions());
      await queueEvents.waitUntilReady();
    });

    afterEach(async function() {
      await queueEvents.close();
    });

    it('should resolve when the job has been completed', async function() {
      const worker = new Worker(queueName, async () => 'qux', queueOptions());

      const job = await queue.add('test', { foo: 'bar' });

      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.eq('qux');

      await worker.close();
    });

    it('should resolve when the job has been completed and return object', async function() {
      const worker = new Worker(
        queueName,
        async () => ({ resultFoo: 'bar' }),
        queueOptions(),
      );

      const job = await queue.add('test', { foo: 'bar' });

      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.be.an('object');
      expect(result.resultFoo).equal('bar');

      await worker.close();
    });

    it('should resolve when the job has been delayed and completed and return object', async function() {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(300);
          return { resultFoo: 'bar' };
        },
        queueOptions(),
      );

      const job = await queue.add('test', { foo: 'bar' });
      await delay(600);

      const result = await job.waitUntilFinished(queueEvents);
      expect(result).to.be.an('object');
      expect(result.resultFoo).equal('bar');

      await worker.close();
    });

    it('should resolve when the job has been completed and return string', async function() {
      const worker = new Worker(
        queueName,
        async () => 'a string',
        queueOptions(),
      );

      const job = await queue.add('test', { foo: 'bar' });

      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.be.an('string');
      expect(result).equal('a string');

      await worker.close();
    });

    it('should reject when the job has been failed', async function() {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(500);
          throw new Error('test error');
        },
        queueOptions(),
      );

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
      const worker = new Worker(
        queueName,
        async () => ({ resultFoo: 'bar' }),
        queueOptions(),
      );

      const job = await queue.add('test', { foo: 'bar' });

      await delay(500);
      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.be.an('object');
      expect(result.resultFoo).equal('bar');

      await worker.close();
    });

    it('should reject directly if already processed', async function() {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('test error');
        },
        queueOptions(),
      );

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
