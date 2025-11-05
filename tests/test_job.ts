/*eslint-env node */
'use strict';

import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { after } from 'lodash';
import {
  afterEach,
  beforeEach,
  describe,
  it,
  before,
  after as afterAll,
} from 'mocha';
import { v4 } from 'uuid';
import { Job, Queue, QueueEvents, Worker } from '../src/classes';
import { JobsOptions } from '../src/types';
import { delay, getParentKey, removeAllQueueData } from '../src/utils';

describe('Job', function () {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;
  let connection;
  before(async function () {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
  });

  afterEach(async function () {
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('.create', function () {
    const timestamp = 1234567890;
    let job: Job;
    let data: any;
    let opts: JobsOptions;

    beforeEach(async function () {
      data = { foo: 'bar' };
      opts = { timestamp };

      const createdJob = await Job.create(queue, 'test', data, opts);
      job = createdJob;
    });

    it('saves the job in redis', async function () {
      const storedJob = await Job.fromId(queue, job.id);
      expect(storedJob).to.have.property('id');
      expect(storedJob).to.have.property('data');

      expect(storedJob.data.foo).to.be.equal('bar');
      expect(storedJob.opts).to.be.an('object');
      expect(storedJob.opts.timestamp).to.be.equal(timestamp);
    });

    it('should use the custom jobId if one is provided', async function () {
      const customJobId = 'customjob';
      const createdJob = await Job.create(queue, 'test', data, {
        jobId: customJobId,
      });
      expect(createdJob.id).to.be.equal(customJobId);
    });

    describe('when custom jobId is provided as empty string', function () {
      it('should ignore the empty custom id and generates a numeric id', async function () {
        const job = await Job.create(queue, 'test', data, {
          jobId: '',
        });
        expect(job.id).to.be.equal('2');
      });
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
        const opts: JobsOptions = {
          parent: { id: parentId, queue: `${prefix}:${queueName}` },
        };
        await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
          `Missing key for parent job ${prefix}:${queueName}:${parentId}. addJob`,
        );
      });
    });

    describe('when delay and repeat options are provided', () => {
      it('throws an error', async () => {
        const data = { foo: 'bar' };
        const opts = { repeat: { every: 200 }, delay: 1000 };
        await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
          'Delay and repeat options could not be used together',
        );
      });
    });

    describe('when removeDependencyOnFailure and failParentOnFailure options are provided', () => {
      it('throws an error', async () => {
        const data = { foo: 'bar' };
        const opts = {
          removeDependencyOnFailure: true,
          failParentOnFailure: true,
        };
        await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
          'The following options cannot be used together: removeDependencyOnFailure, failParentOnFailure',
        );
      });
    });

    describe('when removeDependencyOnFailure and ignoreDependencyOnFailure options are provided', () => {
      it('throws an error', async () => {
        const data = { foo: 'bar' };
        const opts = {
          removeDependencyOnFailure: true,
          ignoreDependencyOnFailure: true,
        };
        await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
          'The following options cannot be used together: removeDependencyOnFailure, ignoreDependencyOnFailure',
        );
      });
    });

    describe('when failParentOnFailure and ignoreDependencyOnFailure options are provided', () => {
      it('throws an error', async () => {
        const data = { foo: 'bar' };
        const opts = {
          ignoreDependencyOnFailure: true,
          failParentOnFailure: true,
        };
        await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
          'The following options cannot be used together: failParentOnFailure, ignoreDependencyOnFailure',
        );
      });
    });

    describe('when priority option is provided as float', () => {
      it('throws an error', async () => {
        const data = { foo: 'bar' };
        const opts = { priority: 1.1 };
        await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
          'Priority should not be float',
        );
      });
    });

    describe('when priority option is provided with a value greater than 2097152', () => {
      it('throws an error', async () => {
        const data = { foo: 'bar' };
        const opts = { priority: 2097153 };
        await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
          'Priority should be between 0 and 2097152',
        );
      });
    });

    describe('when deduplication id option is provided as empty string', () => {
      it('throws an error', async () => {
        const data = { foo: 'bar' };
        const opts = { deduplication: { id: '' } };
        await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
          'Deduplication id must be provided',
        );
      });
    });

    describe('when debounce id option is provided as empty string', () => {
      it('throws an error', async () => {
        const data = { foo: 'bar' };
        const opts = { debounce: { id: '' } };
        await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
          'Debounce id must be provided',
        );
      });
    });

    describe('when jitter backoff option is provided with a value lesser than 0', () => {
      it('throws an error', async () => {
        const data = { foo: 'bar' };
        const opts = { backoff: { type: 'fixed', jitter: -1 } };
        await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
          'Jitter should be between 0 and 1',
        );
      });
    });

    describe('when jitter backoff option is provided with a value greater than 1', () => {
      it('throws an error', async () => {
        const data = { foo: 'bar' };
        const opts = { backoff: { type: 'fixed', jitter: 5 } };
        await expect(Job.create(queue, 'test', data, opts)).to.be.rejectedWith(
          'Jitter should be between 0 and 1',
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

      const newQueue = new Queue(queueName, { connection, prefix });
      let worker: Worker;
      const promise = new Promise<void>(async (resolve, reject) => {
        worker = new Worker(
          queueName,
          async job => {
            try {
              expect(job.data).to.be.equal(0);
            } catch (err) {
              reject(err);
            }
            resolve();
          },
          { connection, prefix },
        );
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

  describe('.update', function () {
    it('should allow updating job data', async function () {
      const job = await Job.create<{ foo?: string; baz?: string }>(
        queue,
        'test',
        {
          foo: 'bar',
        },
      );
      await job.updateData({ baz: 'qux' });

      const updatedJob = await Job.fromId(queue, job.id);
      expect(updatedJob.data).to.be.eql({ baz: 'qux' });
    });

    describe('when job is removed', () => {
      it('throws error', async function () {
        const job = await Job.create(queue, 'test', { foo: 'bar' });
        await job.remove();
        await expect(job.updateData({ foo: 'baz' })).to.be.rejectedWith(
          `Missing key for job ${job.id}. updateData`,
        );
      });
    });
  });

  describe('.remove', function () {
    it('removes the job from redis', async function () {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      await job.remove();
      const storedJob = await Job.fromId(queue, job.id);
      expect(storedJob).to.be.equal(undefined);
    });

    it('removes processed hash', async function () {
      const client = await queue.client;
      const values = [{ idx: 0, bar: 'something' }];
      const token = 'my-token';
      const token2 = 'my-token2';
      const parentQueueName = `parent-queue-${v4()}`;

      const parentQueue = new Queue(parentQueueName, { connection, prefix });
      const parentWorker = new Worker(parentQueueName, null, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(queueName, null, {
        connection,
        prefix,
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const data = { foo: 'bar' };
      const parent = await Job.create(parentQueue, 'testParent', data);
      await Job.create(queue, 'testJob1', values[0], {
        parent: { id: parent.id, queue: `${prefix}:${parentQueueName}` },
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
        `${prefix}:${parentQueueName}:${parentId}:processed`,
      );

      expect(processed).to.deep.equal({});

      await childrenWorker.close();
      await parentWorker.close();
      await parentQueue.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it('removes 4000 jobs in time rage of 4000ms', async function () {
      this.timeout(8000);
      const numJobs = 4000;

      // Create waiting jobs
      const jobsData = Array.from(Array(numJobs).keys()).map(index => ({
        name: 'test',
        data: { order: numJobs - index },
      }));
      const waitingJobs = await queue.addBulk(jobsData);

      // Creating delayed jobs
      const jobsDataWithDelay = Array.from(Array(numJobs).keys()).map(
        index => ({
          name: 'test',
          data: { order: numJobs - index },
          opts: {
            delay: 500 + (numJobs - index) * 150,
          },
        }),
      );
      const delayedJobs = await queue.addBulk(jobsDataWithDelay);

      const startTime = Date.now();
      // Remove all jobs
      await Promise.all(delayedJobs.map(job => job.remove()));
      await Promise.all(waitingJobs.map(job => job.remove()));

      expect(Date.now() - startTime).to.be.lessThan(4000);

      const countJobs = await queue.getJobCountByTypes('waiting', 'delayed');
      expect(countJobs).to.be.equal(0);
    });
  });

  // TODO: Add more remove tests

  describe('.progressProgress', function () {
    it('can set and get progress as number', async function () {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      await job.updateProgress(42);
      const storedJob = await Job.fromId(queue, job.id!);
      expect(storedJob!.progress).to.be.equal(42);
    });

    it('can set and get progress as object', async function () {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      await job.updateProgress({ total: 120, completed: 40 });
      const storedJob = await Job.fromId(queue, job.id!);
      expect(storedJob!.progress).to.eql({ total: 120, completed: 40 });
    });

    it('can set and get progress as string', async function () {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      await job.updateProgress('hello, world!');
      const storedJob = await Job.fromId(queue, job.id!);
      expect(storedJob!.progress).to.eql('hello, world!');
    });

    it('can set and get progress as boolean', async function () {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      await job.updateProgress(false);
      let storedJob = await Job.fromId(queue, job.id!);
      expect(storedJob!.progress).to.eql(false);
      await job.updateProgress(true);
      storedJob = await Job.fromId(queue, job.id!);
      expect(storedJob!.progress).to.eql(true);
    });

    it('can set progress as number using the Queue instance', async () => {
      const job = await Job.create(queue, 'test', { foo: 'bar' });

      const progress = new Promise<void>(resolve => {
        queue.on('progress', (jobId: string, progress: string | boolean | number | object) => {
          expect(jobId).to.be.eql(job.id);
          expect(progress).to.be.eql(42);
          resolve();
        });
      });
      queue.updateJobProgress(job.id!, 42);
      await progress;

      const storedJob = await Job.fromId(queue, job.id!);
      expect(storedJob!.progress).to.be.equal(42);
    });

    it('can set progress as object using the Queue instance', async () => {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      await queue.updateJobProgress(job.id!, { total: 120, completed: 40 });
      const storedJob = await Job.fromId(queue, job.id!);
      expect(storedJob!.progress).to.eql({ total: 120, completed: 40 });
    });

    describe('when job is removed', () => {
      it('throws error', async function () {
        const job = await Job.create(queue, 'test', { foo: 'bar' });
        await job.remove();
        await expect(
          job.updateProgress({ total: 120, completed: 40 }),
        ).to.be.rejectedWith(`Missing key for job ${job.id}. updateProgress`);
      });
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

    it('should preserve up to keepLogs latest entries', async () => {
      const firstLog = 'some log text 1';
      const secondLog = 'some log text 2';
      const thirdLog = 'some log text 3';

      const job = await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { keepLogs: 2 },
      );

      const count1 = await job.log(firstLog);
      expect(count1).to.be.equal(1);

      const logs1 = await queue.getJobLogs(job.id!);
      expect(logs1).to.be.eql({ logs: [firstLog], count: 1 });

      const count2 = await job.log(secondLog);
      expect(count2).to.be.equal(2);

      const logs2 = await queue.getJobLogs(job.id!);
      expect(logs2).to.be.eql({ logs: [firstLog, secondLog], count: 2 });

      const count3 = await job.log(thirdLog);
      expect(count3).to.be.equal(2);

      const logs3 = await queue.getJobLogs(job.id!);
      expect(logs3).to.be.eql({ logs: [secondLog, thirdLog], count: 2 });
    });

    it('should allow to add job logs from Queue instance', async () => {
      const firstLog = 'some log text 1';
      const secondLog = 'some log text 2';

      const job = await Job.create(queue, 'test', { foo: 'bar' });

      await queue.addJobLog(job.id!, firstLog);
      await queue.addJobLog(job.id!, secondLog);

      const logs = await queue.getJobLogs(job.id!);

      expect(logs).to.be.eql({ logs: [firstLog, secondLog], count: 2 });
    });

    describe('when job is removed', () => {
      it('throws error', async function () {
        const job = await Job.create(queue, 'test', { foo: 'bar' });
        await job.remove();
        await expect(job.log('oneLog')).to.be.rejectedWith(
          `Missing key for job ${job.id}. addLog`,
        );
      });
    });
  });

  describe('.clearLogs', () => {
    it('can clear the log', async () => {
      const firstLog = 'some log text 1';
      const secondLog = 'some log text 2';

      const job = await Job.create(queue, 'test', { foo: 'bar' });

      await job.log(firstLog);
      await job.log(secondLog);
      const logs = await queue.getJobLogs(job.id);
      expect(logs).to.be.eql({ logs: [firstLog, secondLog], count: 2 });

      await job.clearLogs();

      const logsRemoved = await queue.getJobLogs(job.id);
      expect(logsRemoved).to.be.eql({ logs: [], count: 0 });
    });

    it('can preserve up to keepLogs latest entries', async () => {
      const firstLog = 'some log text 1';
      const secondLog = 'some log text 2';
      const thirdLog = 'some log text 3';

      const job = await Job.create(queue, 'test', { foo: 'bar' });

      await job.log(firstLog);
      await job.log(secondLog);
      await job.log(thirdLog);

      const logs1 = await queue.getJobLogs(job.id);
      expect(logs1).to.be.eql({
        logs: [firstLog, secondLog, thirdLog],
        count: 3,
      });

      await job.clearLogs(4);

      const logs2 = await queue.getJobLogs(job.id);
      expect(logs2).to.be.eql({
        logs: [firstLog, secondLog, thirdLog],
        count: 3,
      });

      await job.clearLogs(3);

      const logs3 = await queue.getJobLogs(job.id);
      expect(logs3).to.be.eql({
        logs: [firstLog, secondLog, thirdLog],
        count: 3,
      });

      await job.clearLogs(2);

      const logs4 = await queue.getJobLogs(job.id);
      expect(logs4).to.be.eql({ logs: [secondLog, thirdLog], count: 2 });

      await job.clearLogs(0);

      const logsRemoved = await queue.getJobLogs(job.id);
      expect(logsRemoved).to.be.eql({ logs: [], count: 0 });
    });
  });

  describe('.moveToCompleted', function () {
    it('marks the job as completed and returns new job', async function () {
      const worker = new Worker(queueName, null, { connection, prefix });
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
    it('should not fail if queue meta key is missing', async function () {
      const worker = new Worker(queueName, null, { connection, prefix });
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

      const parentQueue = new Queue(parentQueueName, { connection, prefix });

      const parentWorker = new Worker(parentQueueName, null, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(queueName, null, {
        connection,
        prefix,
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const data = { foo: 'bar' };
      const parent = await Job.create(parentQueue, 'testParent', data);
      const parentKey = getParentKey({
        id: parent.id!,
        queue: `${prefix}:${parentQueueName}`,
      });
      const client = await queue.client;
      const child1 = new Job(queue, 'testJob1', values[0]);
      await child1.addJob(client, {
        parentKey,
        parentDependenciesKey: `${parentKey}:dependencies`,
      });
      await Job.create(queue, 'testJob2', values[1], {
        parent: {
          id: parent.id!,
          queue: `${prefix}:${parentQueueName}`,
        },
      });

      const job = (await parentWorker.getNextJob(token)) as Job;
      const { unprocessed } = await parent.getDependencies();

      expect(unprocessed).to.have.length(2);

      const isActive = await job.isActive();
      expect(isActive).to.be.equal(true);

      await expect(
        job.moveToCompleted('return value', token),
      ).to.be.rejectedWith(
        `Job ${job.id} has pending dependencies. moveToFinished`,
      );

      const lock = await client.get(
        `${prefix}:${parentQueueName}:${job.id}:lock`,
      );

      expect(lock).to.be.equal(token);

      const isCompleted = await job.isCompleted();

      expect(isCompleted).to.be.false;

      await childrenWorker.close();
      await parentWorker.close();
      await parentQueue.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });
  });

  describe('.moveToFailed', function () {
    it('marks the job as failed', async function () {
      const worker = new Worker(queueName, null, { connection, prefix });
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
      expect(job.stacktrace[0]).to.include('test_job.ts');
      await worker.close();
    });

    describe('when using a custom error', function () {
      it('marks the job as failed', async function () {
        class CustomError extends Error {}
        const worker = new Worker(queueName, null, { connection, prefix });
        const token = 'my-token';
        await Job.create(queue, 'test', { foo: 'bar' });
        const job = (await worker.getNextJob(token)) as Job;
        const isFailed = await job.isFailed();
        expect(isFailed).to.be.equal(false);
        await job.moveToFailed(new CustomError('test error'), '0', true);
        const isFailed2 = await job.isFailed();
        expect(isFailed2).to.be.equal(true);
        expect(job.stacktrace).not.be.equal(null);
        expect(job.stacktrace.length).to.be.equal(1);
        expect(job.stacktrace[0]).to.include('test_job.ts');
        await worker.close();
      });
    });

    it('moves the job to wait for retry if attempts are given', async function () {
      const queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();
      const worker = new Worker(queueName, null, { connection, prefix });

      await Job.create(queue, 'test', { foo: 'bar' }, { attempts: 3 });
      const token = 'my-token';
      const job = (await worker.getNextJob(token)) as Job;

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
      await worker.close();
    });

    describe('when job is not in active state', function () {
      it('throws an error', async function () {
        const queueEvents = new QueueEvents(queueName, { connection, prefix });
        await queueEvents.waitUntilReady();

        const job = await Job.create(
          queue,
          'test',
          { foo: 'bar' },
          { attempts: 3 },
        );
        const isFailed = await job.isFailed();
        expect(isFailed).to.be.equal(false);

        await expect(
          job.moveToFailed(new Error('test error'), '0', true),
        ).to.be.rejectedWith(
          `Job ${job.id} is not in the active state. retryJob`,
        );

        await queueEvents.close();
      });
    });

    describe('when job is removed', function () {
      it('should not save stacktrace', async function () {
        const client = await queue.client;
        const worker = new Worker(queueName, null, {
          connection,
          prefix,
          lockDuration: 100,
          skipLockRenewal: true,
        });
        const token = 'my-token';
        await Job.create(queue, 'test', { foo: 'bar' }, { attempts: 1 });
        const job = (await worker.getNextJob(token)) as Job;
        await delay(105);
        await job.remove();

        await expect(
          job.moveToFailed(new Error('test error'), '0'),
        ).to.be.rejectedWith(`Missing key for job ${job.id}. moveToFinished`);

        const processed = await client.hgetall(
          `${prefix}:${queueName}:${job.id}`,
        );

        expect(processed).to.deep.equal({});

        await worker.close();
      });
    });

    describe('when attempts made equal to attempts given', function () {
      it('marks the job as failed', async function () {
        const worker = new Worker(queueName, null, { connection, prefix });
        const token = 'my-token';
        await Job.create(queue, 'test', { foo: 'bar' }, { attempts: 1 });
        const job = (await worker.getNextJob(token)) as Job;
        const isFailed = await job.isFailed();

        expect(isFailed).to.be.equal(false);

        await job.moveToFailed(new Error('test error'), '0', true);
        const state = await job.getState();
        const isFailed2 = await job.isFailed();

        expect(isFailed2).to.be.equal(true);
        expect(state).to.be.equal('failed');
        expect(job.stacktrace).not.be.equal(null);
        expect(job.stacktrace.length).to.be.equal(1);
        await worker.close();
      });
    });

    describe('when attempts are given and backoff is non zero', function () {
      it('moves the job to delayed for retry', async function () {
        const worker = new Worker(queueName, null, { connection, prefix });
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
        const state = await job.getState();
        const isFailed2 = await job.isFailed();

        expect(isFailed2).to.be.equal(false);
        expect(job.stacktrace).not.be.equal(null);
        expect(job.stacktrace.length).to.be.equal(1);
        const isDelayed = await job.isDelayed();
        expect(isDelayed).to.be.equal(true);
        expect(state).to.be.equal('delayed');
        await worker.close();
      });
    });

    it('applies stacktrace limit on failure', async function () {
      const worker = new Worker(queueName, null, { connection, prefix });
      const token = 'my-token';
      const stackTraceLimit = 1;
      await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { stackTraceLimit: stackTraceLimit, attempts: 2 },
      );
      const job = (await worker.getNextJob(token)) as Job;
      const isFailed = await job.isFailed();
      expect(isFailed).to.be.equal(false);
      // first time failed.
      await job.moveToFailed(new Error('failed once'), '0', true);
      const isFailed1 = await job.isFailed();
      const stackTrace1 = job.stacktrace[0];
      expect(isFailed1).to.be.false;
      expect(job.stacktrace).not.be.equal(null);
      expect(job.stacktrace.length).to.be.equal(stackTraceLimit);
      // second time failed.
      const again = (await worker.getNextJob(token)) as Job;
      await again.moveToFailed(new Error('failed twice'), '0', true);
      const isFailed2 = await again.isFailed();
      const stackTrace2 = again.stacktrace[0];
      expect(isFailed2).to.be.true;
      expect(again.name).to.be.equal(job.name);
      expect(again.stacktrace.length).to.be.equal(stackTraceLimit);
      expect(stackTrace1).not.be.equal(stackTrace2);
      await worker.close();
    });

    describe('when stackTraceLimit is provided as 0', function () {
      it('keep stacktrace empty', async function () {
        const worker = new Worker(queueName, null, { connection, prefix });
        const token = 'my-token';
        const stackTraceLimit = 0;
        await Job.create(
          queue,
          'test',
          { foo: 'bar' },
          { stackTraceLimit: stackTraceLimit, attempts: 2 },
        );
        const job = (await worker.getNextJob(token)) as Job;
        const isFailed = await job.isFailed();
        expect(isFailed).to.be.equal(false);
        // first time failed.
        await job.moveToFailed(new Error('failed once'), '0', true);
        const isFailed1 = await job.isFailed();
        expect(isFailed1).to.be.false;
        expect(job.stacktrace.length).to.be.equal(stackTraceLimit);
        // second time failed.
        const again = (await worker.getNextJob(token)) as Job;
        await again.moveToFailed(new Error('failed twice'), '0', true);
        const isFailed2 = await again.isFailed();
        expect(isFailed2).to.be.true;
        expect(again.name).to.be.equal(job.name);
        expect(again.stacktrace.length).to.be.equal(stackTraceLimit);
        await worker.close();
      });
    });

    it('saves error stacktrace', async function () {
      const worker = new Worker(queueName, null, { connection, prefix });
      const token = 'my-token';
      await Job.create(queue, 'test', { foo: 'bar' });
      const job = (await worker.getNextJob(token)) as Job;
      const id = job.id;
      await job.moveToFailed(new Error('test error'), '0');
      const sameJob = await queue.getJob(id!);
      expect(sameJob).to.be.ok;
      expect(sameJob.stacktrace).to.be.not.empty;
      await worker.close();
    });
  });

  describe('.moveToWait', () => {
    it('moves job to wait from active', async function () {
      const worker = new Worker(queueName, null, { connection, prefix });
      const token = 'my-token';
      await Job.create(queue, 'test', { foo: 'bar' });
      const job = (await worker.getNextJob(token)) as Job;
      const isWaiting = await job.isWaiting();
      expect(isWaiting).to.be.equal(false);
      await job.moveToWait(token);
      const isisWaiting2 = await job.isWaiting();
      expect(isisWaiting2).to.be.equal(true);
      await worker.close();
    });
  });

  describe('.changeDelay', () => {
    it('can change delay of a delayed job', async function () {
      this.timeout(8000);

      const worker = new Worker(queueName, async () => {}, {
        connection,
        prefix,
      });
      await worker.waitUntilReady();

      const startTime = new Date().getTime();

      const completing = new Promise<void>(resolve => {
        worker.on('completed', async () => {
          const timeDiff = new Date().getTime() - startTime;
          expect(timeDiff).to.be.gte(2000);
          resolve();
        });
      });

      const job = await Job.create(
        queue,
        'test',
        { foo: 'bar' },
        { delay: 8000 },
      );

      const isDelayed = await job.isDelayed();
      expect(isDelayed).to.be.equal(true);

      await job.changeDelay(2000);

      const isDelayedAfterChangeDelay = await job.isDelayed();
      expect(isDelayedAfterChangeDelay).to.be.equal(true);
      expect(job.delay).to.be.equal(2000);

      await completing;

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

  describe('.changePriority', () => {
    describe('when job is in wait state', () => {
      describe('when lifo option is provided as true', () => {
        it('moves job to the head of wait list', async () => {
          await queue.pause();
          await Job.create(queue, 'test1', { foo: 'bar' });
          const job = await Job.create(
            queue,
            'test2',
            { foo: 'bar' },
            { priority: 16 },
          );

          expect(job.priority).to.be.eql(16);

          await job.changePriority({
            priority: 0,
            lifo: true,
          });

          expect(job.priority).to.be.eql(0);

          const worker = new Worker(
            queueName,
            async () => {
              await delay(20);
            },
            { connection, prefix },
          );
          await worker.waitUntilReady();

          const completing = new Promise<void>(resolve => {
            worker.on(
              'completed',
              after(2, job => {
                expect(job.name).to.be.eql('test1');
                resolve();
              }),
            );
          });

          await queue.resume();

          await completing;

          await worker.close();
        });
      });

      describe('when lifo option is provided as false', () => {
        it('moves job to the tail of wait list and has more priority', async () => {
          await queue.pause();
          const job = await Job.create(
            queue,
            'test1',
            { foo: 'bar' },
            { priority: 8 },
          );
          await Job.create(queue, 'test2', { foo: 'bar' });

          await job.changePriority({
            priority: 0,
            lifo: false,
          });

          const worker = new Worker(
            queueName,
            async () => {
              await delay(20);
            },
            { connection, prefix },
          );
          await worker.waitUntilReady();

          const completing = new Promise<void>(resolve => {
            worker.on(
              'completed',
              after(2, job => {
                expect(job.name).to.be.eql('test1');
                resolve();
              }),
            );
          });

          await queue.resume();

          await completing;

          await worker.close();
        });
      });
    });

    describe('when job is in prioritized state', () => {
      it('can change priority of a job', async function () {
        await Job.create(queue, 'test1', { foo: 'bar' }, { priority: 8 });
        const job = await Job.create(
          queue,
          'test2',
          { foo: 'bar' },
          { priority: 16 },
        );

        await job.changePriority({
          priority: 1,
        });

        const worker = new Worker(
          queueName,
          async (job: Job) => {
            if (job.name === 'test1') {
              expect(job.priority).to.be.eql(8);
            } else {
              expect(job.priority).to.be.eql(1);
            }
            await delay(20);
          },
          { connection, prefix },
        );
        await worker.waitUntilReady();

        const completing = new Promise<void>(resolve => {
          worker.on(
            'completed',
            after(2, job => {
              expect(job.name).to.be.eql('test1');
              resolve();
            }),
          );
        });

        await completing;

        await worker.close();
      });

      describe('when lifo option is provided as true', () => {
        it('moves job to the head of prioritized jobs with same priority', async () => {
          await queue.pause();
          await Job.create(queue, 'test1', { foo: 'bar' }, { priority: 16 });
          const job = await Job.create(
            queue,
            'test2',
            { foo: 'bar' },
            { priority: 16 },
          );

          await job.changePriority({
            priority: 16,
            lifo: true,
          });

          const worker = new Worker(
            queueName,
            async () => {
              await delay(20);
            },
            { connection, prefix },
          );
          await worker.waitUntilReady();

          const completing = new Promise<void>(resolve => {
            worker.on(
              'completed',
              after(2, job => {
                expect(job.name).to.be.eql('test1');
                resolve();
              }),
            );
          });

          await queue.resume();

          await completing;

          await worker.close();
        });
      });
    });

    describe('when queue is paused', () => {
      it('respects new priority', async () => {
        await queue.pause();
        await Job.create(queue, 'test1', { foo: 'bar' }, { priority: 8 });
        const job = await Job.create(
          queue,
          'test2',
          { foo: 'bar' },
          { priority: 16 },
        );

        await job.changePriority({
          priority: 1,
        });

        const worker = new Worker(
          queueName,
          async () => {
            await delay(20);
          },
          { connection, prefix },
        );
        await worker.waitUntilReady();

        const completing = new Promise<void>(resolve => {
          worker.on(
            'completed',
            after(2, job => {
              expect(job.name).to.be.eql('test1');
              resolve();
            }),
          );
        });

        await queue.resume();

        await completing;

        await worker.close();
      });
    });

    describe('when job is not in wait or prioritized state', () => {
      it('does not add a record in priority zset', async () => {
        const job = await Job.create(
          queue,
          'test1',
          { foo: 'bar' },
          { delay: 500 },
        );

        await job.changePriority({
          priority: 10,
        });

        const client = await queue.client;
        const count = await client.zcard(`${prefix}:${queueName}:priority`);
        const priority = await client.hget(
          `${prefix}:${queueName}:${job.id}`,
          'priority',
        );

        expect(count).to.be.eql(0);
        expect(priority).to.be.eql('10');
      });
    });

    describe('when job does not exist', () => {
      it('throws an error', async () => {
        const job = await Job.create(queue, 'test', { foo: 'bar' });
        await job.remove();

        await expect(job.changePriority({ priority: 2 })).to.be.rejectedWith(
          `Missing key for job ${job.id}. changePriority`,
        );
      });
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
      expect(job.delay).to.be.equal(0);

      const isDelayedAfterPromote = await job.isDelayed();
      expect(isDelayedAfterPromote).to.be.equal(false);
      const isWaiting = await job.isWaiting();
      expect(isWaiting).to.be.equal(true);
    });

    it('should process a promoted job according to its priority', async function () {
      this.timeout(5000);
      const completed: string[] = [];
      const worker = new Worker(
        queueName,
        job => {
          completed.push(job.id!);
          return delay(200);
        },
        { connection, prefix, autorun: false },
      );
      await worker.waitUntilReady();

      const completing = new Promise<void>((resolve, reject) => {
        worker.on(
          'completed',
          after(4, () => {
            try {
              expect(completed).to.be.eql(['a', 'b', 'c', 'd']);
              resolve();
            } catch (err) {
              reject(err);
            }
          }),
        );
      });

      await queue.add('test', {}, { jobId: 'a', priority: 1 });
      await queue.add('test', {}, { jobId: 'b', priority: 2 });
      await queue.add('test', {}, { jobId: 'd', priority: 4 });
      const job = await queue.add(
        'test',
        {},
        { jobId: 'c', delay: 2000, priority: 3 },
      );
      await job.promote();

      worker.run();

      await completing;
      await worker.close();
    });

    it('should not promote a job that is not delayed', async () => {
      const job = await Job.create(queue, 'test', { foo: 'bar' });
      const isDelayed = await job.isDelayed();
      expect(isDelayed).to.be.equal(false);

      await expect(job.promote()).to.be.rejectedWith(
        `Job ${job.id} is not in the delayed state. promote`,
      );
    });

    describe('when a repeatable job is promoted', () => {
      it('add next delayed job after promoted job completion', async () => {
        const job = await queue.add(
          'test',
          { foo: 'bar' },
          {
            repeat: {
              pattern: '0 0 7 * * *',
            },
          },
        );
        const isDelayed = await job.isDelayed();
        expect(isDelayed).to.be.equal(true);
        await job.promote();
        expect(job.delay).to.be.equal(0);

        const worker = new Worker(queueName, null, { connection, prefix });

        const currentJob1 = (await worker.getNextJob('token')) as Job;
        expect(currentJob1).to.not.be.undefined;

        await currentJob1.moveToCompleted('succeeded', 'token', true);

        const delayedCount = await queue.getDelayedCount();
        expect(delayedCount).to.be.equal(1);

        const isDelayedAfterPromote = await job.isDelayed();
        expect(isDelayedAfterPromote).to.be.equal(false);
        const isCompleted = await job.isCompleted();
        expect(isCompleted).to.be.equal(true);
        await worker.close();
      });

      describe('when re-adding same repeatable job after previous delayed one is promoted', () => {
        it('keep one delayed job', async () => {
          const job = await queue.add(
            'test',
            { foo: 'bar' },
            {
              repeat: {
                pattern: '0 0 7 * * *',
              },
            },
          );
          const isDelayed = await job.isDelayed();
          expect(isDelayed).to.be.equal(true);

          await queue.add(
            'test',
            { foo: 'bar' },
            {
              repeat: {
                pattern: '0 0 7 * * *',
              },
            },
          );
          const delayedCount = await queue.getDelayedCount();
          expect(delayedCount).to.be.equal(1);

          await job.promote();
          expect(job.delay).to.be.equal(0);

          const worker = new Worker(queueName, null, { connection, prefix });
          const currentJob1 = (await worker.getNextJob('token')) as Job;
          expect(currentJob1).to.not.be.undefined;

          await currentJob1.moveToCompleted('succeeded', 'token', true);
          const completedCount = await queue.getCompletedCount();
          const delayedCountAfterPromote = await queue.getDelayedCount();
          expect(completedCount).to.be.equal(1);
          expect(delayedCountAfterPromote).to.be.equal(1);

          const completedCountAfterRestart = await queue.getCompletedCount();
          const delayedCountAfterRestart = await queue.getDelayedCount();
          expect(completedCountAfterRestart).to.be.equal(1);
          expect(delayedCountAfterRestart).to.be.equal(1);

          await queue.add(
            'test',
            { foo: 'bar' },
            {
              repeat: {
                pattern: '0 0 7 * * *',
              },
            },
          );

          const completedCountAfterReAddition = await queue.getCompletedCount();
          const delayedCountAfterReAddition = await queue.getDelayedCount();
          expect(completedCountAfterReAddition).to.be.equal(1);
          expect(delayedCountAfterReAddition).to.be.equal(1);
          await worker.close();
        });
      });
    });

    describe('when queue is paused', () => {
      it('should promote delayed job to the right queue', async () => {
        await queue.add('normal', { foo: 'bar' });
        const delayedJob = await queue.add(
          'delayed',
          { foo: 'bar' },
          { delay: 100 },
        );

        await queue.pause();
        await delayedJob.promote();

        const pausedJobsCount = await queue.getJobCountByTypes('paused');
        expect(pausedJobsCount).to.be.equal(2);
        await queue.resume();

        const waitingJobsCount = await queue.getWaitingCount();
        expect(waitingJobsCount).to.be.equal(2);
        const delayedJobsNewState = await delayedJob.getState();
        expect(delayedJobsNewState).to.be.equal('waiting');
      });
    });

    describe('when queue is empty', () => {
      it('should promote delayed job to the right queue', async () => {
        const delayedJob = await queue.add(
          'delayed',
          { foo: 'bar' },
          { delay: 100 },
        );

        await queue.pause();
        await delayedJob.promote();

        const pausedJobsCount = await queue.getJobCountByTypes('paused');
        expect(pausedJobsCount).to.be.equal(1);
        await queue.resume();

        const waitingJobsCount = await queue.getWaitingCount();
        expect(waitingJobsCount).to.be.equal(1);
        const delayedJobsNewState = await delayedJob.getState();
        expect(delayedJobsNewState).to.be.equal('waiting');
      });
    });
  });

  describe('.getState', () => {
    it('should get job actual state', async () => {
      const worker = new Worker(queueName, null, { connection, prefix });
      const token = 'my-token';
      const job = await queue.add('job1', { foo: 'bar' }, { delay: 1000 });
      const delayedState = await job.getState();

      expect(delayedState).to.be.equal('delayed');

      await queue.pause();
      await job.promote();
      await queue.resume();
      const waitingState = await job.getState();

      expect(waitingState).to.be.equal('waiting');

      const currentJob1 = (await worker.getNextJob(token)) as Job;
      expect(currentJob1).to.not.be.undefined;

      await currentJob1.moveToFailed(new Error('test error'), token, true);
      const failedState = await currentJob1.getState();
      await queue.add('job2', { foo: 'foo' });
      const job2 = (await worker.getNextJob(token)) as Job;

      expect(failedState).to.be.equal('failed');

      await job2.moveToCompleted('succeeded', token, true);
      const completedState = await job2.getState();

      expect(completedState).to.be.equal('completed');
      await worker.close();
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

  describe('.finished', function () {
    let queueEvents: QueueEvents;

    beforeEach(async function () {
      queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();
    });

    afterEach(async function () {
      await queueEvents.close();
    });

    it('should resolve when the job has been completed', async function () {
      const worker = new Worker(queueName, async () => 'qux', {
        connection,
        prefix,
      });

      const job = await queue.add('test', { foo: 'bar' });

      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.be.equal('qux');

      await worker.close();
    });

    describe('when job was added with removeOnComplete', async () => {
      it('rejects with missing key for job message', async function () {
        const worker = new Worker(
          queueName,
          async () => {
            await delay(100);
            return 'qux';
          },
          {
            connection,
            prefix,
          },
        );
        await worker.waitUntilReady();

        const completed = new Promise<void>((resolve, reject) => {
          worker.on('completed', async (job: Job) => {
            try {
              const gotJob = await queue.getJob(job.id!);
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
          `Missing key for job ${queue.toKey(job.id!)}. isFinished`,
        );

        await worker.close();
      });
    });

    it('should resolve when the job has been completed and return object', async function () {
      const worker = new Worker(queueName, async () => ({ resultFoo: 'bar' }), {
        connection,
        prefix,
      });

      const job = await queue.add('test', { foo: 'bar' });

      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.be.an('object');
      expect(result.resultFoo).equal('bar');

      await worker.close();
    });

    it('should resolve when the job has been delayed and completed and return object', async function () {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(300);
          return { resultFoo: 'bar' };
        },
        { connection, prefix },
      );

      const job = await queue.add('test', { foo: 'bar' });
      await delay(600);

      const result = await job.waitUntilFinished(queueEvents);
      expect(result).to.be.an('object');
      expect(result.resultFoo).equal('bar');

      await worker.close();
    });

    it('should resolve when the job has been completed and return string', async function () {
      const worker = new Worker(queueName, async () => 'a string', {
        connection,
        prefix,
      });

      const job = await queue.add('test', { foo: 'bar' });

      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.be.an('string');
      expect(result).equal('a string');

      await worker.close();
    });

    it('should reject when the job has been failed', async function () {
      const worker = new Worker(
        queueName,
        async () => {
          await delay(500);
          throw new Error('test error');
        },
        { connection, prefix },
      );

      const job = await queue.add('test', { foo: 'bar' });

      await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
        'test error',
      );

      await worker.close();
    });

    it('should resolve directly if already processed', async function () {
      const worker = new Worker(queueName, async () => ({ resultFoo: 'bar' }), {
        connection,
        prefix,
      });

      const job = await queue.add('test', { foo: 'bar' });

      await delay(500);
      const result = await job.waitUntilFinished(queueEvents);

      expect(result).to.be.an('object');
      expect(result.resultFoo).equal('bar');

      await worker.close();
    });

    it('should reject directly if already processed', async function () {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('test error');
        },
        { connection, prefix },
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
