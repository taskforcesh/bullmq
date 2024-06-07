/*eslint-env node */
'use strict';

import { expect } from 'chai';
import { after } from 'lodash';
import { describe, beforeEach, it, before, after as afterAll } from 'mocha';
import { default as IORedis } from 'ioredis';
import { v4 } from 'uuid';
import { FlowProducer, Queue, QueueEvents, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Jobs getters', function () {
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

  describe('.getQueueEvents', () => {
    it('gets all queueEvents for this queue', async function () {
      const queueEvent = new QueueEvents(queueName, { connection, prefix });
      await queueEvent.waitUntilReady();
      await delay(10);

      const queueEvents = await queue.getQueueEvents();
      expect(queueEvents).to.have.length(1);

      const queueEvent2 = new QueueEvents(queueName, { connection, prefix });
      await queueEvent2.waitUntilReady();
      await delay(10);

      const nextQueueEvents = await queue.getQueueEvents();
      expect(nextQueueEvents).to.have.length(2);

      await queueEvent.close();
      await queueEvent2.close();
    }).timeout(8000);
  });

  describe('.getWorkers', () => {
    it('gets all workers for this queue only', async function () {
      const worker = new Worker(queueName, async () => {}, {
        autorun: false,
        connection,
        prefix,
      });
      await new Promise<void>(resolve => {
        worker.on('ready', () => {
          resolve();
        });
      });

      const workers = await queue.getWorkers();
      expect(workers).to.have.length(1);

      const worker2 = new Worker(queueName, async () => {}, {
        autorun: false,
        connection,
        prefix,
      });
      await new Promise<void>(resolve => {
        worker2.on('ready', () => {
          resolve();
        });
      });

      const nextWorkers = await queue.getWorkers();
      expect(nextWorkers).to.have.length(2);

      const nextWorkersCount = await queue.getWorkersCount();
      expect(nextWorkersCount).to.be.equal(2);

      await worker.close();
      await worker2.close();
    });

    it('gets all workers including their names', async function () {
      const worker = new Worker(queueName, async () => {}, {
        autorun: false,
        connection,
        prefix,
        name: 'worker1',
      });
      await new Promise<void>(resolve => {
        worker.on('ready', () => {
          resolve();
        });
      });

      const workers = await queue.getWorkers();
      expect(workers).to.have.length(1);

      const workersCount = await queue.getWorkersCount();
      expect(workersCount).to.be.equal(1);

      const worker2 = new Worker(queueName, async () => {}, {
        autorun: false,
        connection,
        prefix,
        name: 'worker2',
      });
      await new Promise<void>(resolve => {
        worker2.on('ready', () => {
          resolve();
        });
      });

      const nextWorkers = await queue.getWorkers();
      expect(nextWorkers).to.have.length(2);

      const nextWorkersCount = await queue.getWorkersCount();
      expect(nextWorkersCount).to.be.equal(2);

      const rawnames = nextWorkers.map(nextWorker => {
        const workerValues = nextWorker.rawname.split(':');
        return workerValues[workerValues.length - 1];
      });

      // Check that the worker names are included in the response on the rawname property
      expect(rawnames).to.include('worker1');
      expect(rawnames).to.include('worker2');

      await worker.close();
      await worker2.close();
    });

    it('gets only workers related only to one queue', async function () {
      const queueName2 = `${queueName}2`;
      const queue2 = new Queue(queueName2, { connection, prefix });
      const worker = new Worker(queueName, async () => {}, {
        autorun: false,
        connection,
        prefix,
      });
      await new Promise<void>(resolve => {
        worker.on('ready', () => {
          resolve();
        });
      });
      const worker2 = new Worker(queueName2, async () => {}, {
        autorun: false,
        connection,
        prefix,
      });
      await new Promise<void>(resolve => {
        worker2.on('ready', () => {
          resolve();
        });
      });

      const workers = await queue.getWorkers();
      expect(workers).to.have.length(1);

      const workersCount = await queue.getWorkersCount();
      expect(workersCount).to.be.equal(1);

      const workers2 = await queue2.getWorkers();
      expect(workers2).to.have.length(1);

      const workersCount2 = await queue2.getWorkersCount();
      expect(workersCount2).to.be.equal(1);

      await queue2.close();
      await worker.close();
      await worker2.close();
      await removeAllQueueData(new IORedis(redisHost), queueName2);
    });

    describe('when sharing connection', () => {
      // Test is very flaky on CI, so we skip it for now.
      it('gets all workers for a given queue', async function () {
        const ioredisConnection = new IORedis({
          host: redisHost,
          maxRetriesPerRequest: null,
        });

        const worker = new Worker(queueName, async () => {}, {
          autorun: false,
          connection: ioredisConnection,
          prefix,
        });
        await new Promise<void>(async resolve => {
          worker.on('ready', () => {
            resolve();
          });
          await delay(1000);
          resolve();
        });

        const workers = await queue.getWorkers();
        expect(workers).to.have.length(1);

        const worker2 = new Worker(queueName, async () => {}, {
          connection: ioredisConnection,
          prefix,
        });
        await new Promise<void>(async resolve => {
          worker2.on('ready', () => {
            resolve();
          });
          await delay(1000);
          resolve();
        });

        const nextWorkers = await queue.getWorkers();
        expect(nextWorkers).to.have.length(2);

        await worker.close();
        await worker2.close();
        await ioredisConnection.quit();
      });
    });

    describe('when disconnection happens', () => {
      it('gets all workers even after reconnection', async function () {
        const worker = new Worker(queueName, async () => {}, {
          autorun: false,
          connection,
          prefix,
        });
        await new Promise<void>(resolve => {
          worker.on('ready', () => {
            resolve();
          });
        });
        const client = await worker.waitUntilReady();

        const workers = await queue.getWorkers();
        expect(workers).to.have.length(1);

        await client.disconnect();
        await delay(10);

        const nextWorkers = await queue.getWorkers();
        expect(nextWorkers).to.have.length(0);

        await client.connect();
        await delay(20);
        const nextWorkers2 = await queue.getWorkers();
        expect(nextWorkers2).to.have.length(1);

        await worker.close();
      });
    });
  });

  describe('.getJobState', () => {
    it('gets current job state', async function () {
      const job = await queue.add('test', { foo: 'bar' });

      const jobState = await queue.getJobState(job.id!);

      expect(jobState).to.be.equal('waiting');
    });
  });

  it('should get waiting jobs', async function () {
    await queue.add('test', { foo: 'bar' });
    await queue.add('test', { baz: 'qux' });

    const jobs = await queue.getWaiting();
    expect(jobs).to.be.a('array');
    expect(jobs.length).to.be.equal(2);
    expect(jobs[0].data.foo).to.be.equal('bar');
    expect(jobs[1].data.baz).to.be.equal('qux');
  });

  it('should get all waiting jobs when no range is provided', async () => {
    await Promise.all([
      queue.add('test', { foo: 'bar' }),
      queue.add('test', { baz: 'qux' }),
      queue.add('test', { bar: 'qux' }),
      queue.add('test', { baz: 'xuq' }),
    ]);

    const jobsWithoutProvidingRange = await queue.getWaiting();
    const allJobs = await queue.getWaiting(0, -1);

    expect(allJobs.length).to.be.equal(4);
    expect(jobsWithoutProvidingRange.length).to.be.equal(allJobs.length);

    expect(allJobs[0].data.foo).to.be.equal('bar');
    expect(allJobs[1].data.baz).to.be.equal('qux');
    expect(allJobs[2].data.bar).to.be.equal('qux');
    expect(allJobs[3].data.baz).to.be.equal('xuq');

    expect(jobsWithoutProvidingRange[0].data.foo).to.be.equal('bar');
    expect(jobsWithoutProvidingRange[1].data.baz).to.be.equal('qux');
    expect(jobsWithoutProvidingRange[2].data.bar).to.be.equal('qux');
    expect(jobsWithoutProvidingRange[3].data.baz).to.be.equal('xuq');
  });

  it('should get paused jobs', async function () {
    await queue.pause();
    await Promise.all([
      queue.add('test', { foo: 'bar' }),
      queue.add('test', { baz: 'qux' }),
    ]);
    const jobs = await queue.getWaiting();
    expect(jobs).to.be.a('array');
    expect(jobs.length).to.be.equal(2);
    expect(jobs[0].data.foo).to.be.equal('bar');
    expect(jobs[1].data.baz).to.be.equal('qux');
  });

  it('should get active jobs', async function () {
    let processor;
    const processing = new Promise<void>(resolve => {
      processor = async () => {
        const jobs = await queue.getActive();
        expect(jobs).to.be.a('array');
        expect(jobs.length).to.be.equal(1);
        expect(jobs[0].data.foo).to.be.equal('bar');
        resolve();
      };
    });
    const worker = new Worker(queueName, processor, { connection, prefix });

    await queue.add('test', { foo: 'bar' });
    await processing;

    await worker.close();
  });

  it('should get a specific job', async () => {
    const data = { foo: 'sup!' };
    const job = await queue.add('test', data);
    const returnedJob = await queue.getJob(job.id!);
    expect(returnedJob!.data).to.eql(data);
    expect(returnedJob!.id).to.be.eql(job.id);
  });

  it('should get undefined for nonexistent specific job', async () => {
    const returnedJob = await queue.getJob('test');
    expect(returnedJob).to.be.equal(undefined);
  });

  it('should get completed jobs', async () => {
    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
    });
    let counter = 2;

    const completed = new Promise<void>(resolve => {
      worker.on('completed', async function () {
        counter--;

        if (counter === 0) {
          const jobs = await queue.getCompleted();
          expect(jobs).to.be.a('array');

          // We need a "empty completed" kind of function.
          //expect(jobs.length).to.be.equal(2);
          await worker.close();
          resolve();
        }
      });
    });

    await queue.add('test', { foo: 'bar' });
    await queue.add('test', { baz: 'qux' });

    await completed;
  });

  it('should get failed jobs', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('Forced error');
      },
      { connection, prefix },
    );

    let counter = 2;

    const failed = new Promise<void>(resolve => {
      worker.on('failed', async function () {
        counter--;

        if (counter === 0) {
          const jobs = await queue.getFailed();
          expect(jobs).to.be.a('array');
          expect(jobs).to.have.length(2);
          await worker.close();
          resolve();
        }
      });
    });

    await queue.add('test', { foo: 'bar' });
    await queue.add('test', { baz: 'qux' });

    await failed;
  });

  describe('.count', () => {
    describe('when there are prioritized jobs', () => {
      it('retries count considering prioritized jobs', async () => {
        await queue.waitUntilReady();

        for (const index of Array.from(Array(8).keys())) {
          await queue.add('test', { idx: index }, { priority: index + 1 });
        }
        await queue.add('test', {});

        const count = await queue.count();

        expect(count).to.be.equal(9);
      });
    });
  });

  describe('.getPrioritized', () => {
    it('retries prioritized job instances', async () => {
      await queue.waitUntilReady();

      for (const index of Array.from(Array(8).keys())) {
        await queue.add('test', { idx: index }, { priority: index + 1 });
      }

      const prioritizedJobs = await queue.getPrioritized();

      expect(prioritizedJobs.length).to.be.equal(8);
    });
  });

  describe('.getPrioritizedCount', () => {
    it('retries prioritized count', async () => {
      await queue.waitUntilReady();

      for (const index of Array.from(Array(8).keys())) {
        await queue.add('test', { idx: index }, { priority: index + 1 });
      }

      const prioritizedCount = await queue.getPrioritizedCount();

      expect(prioritizedCount).to.be.equal(8);
    });
  });

  it('should get all failed jobs when no range is provided', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('Forced error');
      },
      { connection, prefix },
    );

    const counter = 4;

    const failed = new Promise<void>(resolve => {
      worker.on(
        'failed',
        after(counter, async () => {
          const jobsWithoutProvidingRange = await queue.getFailed();
          const allJobs = await queue.getFailed(0, -1);

          expect(allJobs).to.be.a('array');
          expect(allJobs).to.have.length(4);
          expect(jobsWithoutProvidingRange).to.be.a('array');
          expect(jobsWithoutProvidingRange).to.have.length(allJobs.length);
          await worker.close();
          resolve();
        }),
      );
    });

    await Promise.all([
      queue.add('test', { foo: 'bar' }),
      queue.add('test', { baz: 'qux' }),
      queue.add('test', { bar: 'qux' }),
      queue.add('test', { baz: 'xuq' }),
    ]);

    await failed;
  });

  /*
  it('fails jobs that exceed their specified timeout', function(done) {
    queue.process(function(job, jobDone) {
      setTimeout(jobDone, 150);
    });

    queue.on('failed', function(job, error) {
      expect(error.message).to.be.eql('operation timed out');
      done();
    });

    queue.on('completed', function() {
      var error = new Error('The job should have timed out');
      done(error);
    });

    queue.add(
      { some: 'data' },
      {
        timeout: 100,
      },
    );
  });
  */

  it('should return all completed jobs when not setting start/end', function (done) {
    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
    });

    worker.on(
      'completed',
      after(3, async function () {
        try {
          const jobs = await queue.getJobs('completed');
          expect(jobs).to.be.an('array').that.have.length(3);
          expect(jobs[0]).to.have.property('finishedOn');
          expect(jobs[1]).to.have.property('finishedOn');
          expect(jobs[2]).to.have.property('finishedOn');

          expect(jobs[0]).to.have.property('processedOn');
          expect(jobs[1]).to.have.property('processedOn');
          expect(jobs[2]).to.have.property('processedOn');

          await worker.close();
          done();
        } catch (err) {
          await worker.close();
          done(err);
        }
      }),
    );

    queue.add('test', { foo: 1 });
    queue.add('test', { foo: 2 });
    queue.add('test', { foo: 3 });
  });

  it('should return all failed jobs when not setting start/end', function (done) {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('error');
      },
      { connection, prefix },
    );

    worker.on(
      'failed',
      after(3, async function () {
        try {
          queue;
          const jobs = await queue.getJobs('failed');
          expect(jobs).to.be.an('array').that.has.length(3);
          expect(jobs[0]).to.have.property('finishedOn');
          expect(jobs[1]).to.have.property('finishedOn');
          expect(jobs[2]).to.have.property('finishedOn');

          expect(jobs[0]).to.have.property('processedOn');
          expect(jobs[1]).to.have.property('processedOn');
          expect(jobs[2]).to.have.property('processedOn');
          await worker.close();
          done();
        } catch (err) {
          done(err);
        }
      }),
    );

    queue.add('test', { foo: 1 });
    queue.add('test', { foo: 2 });
    queue.add('test', { foo: 3 });
  });

  it('should return subset of jobs when setting positive range', function (done) {
    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
    });

    worker.on(
      'completed',
      after(3, async function () {
        try {
          const jobs = await queue.getJobs('completed', 1, 2, true);
          expect(jobs).to.be.an('array').that.has.length(2);
          expect(jobs[0].data.foo).to.be.eql(2);
          expect(jobs[1].data.foo).to.be.eql(3);
          expect(jobs[0]).to.have.property('finishedOn');
          expect(jobs[1]).to.have.property('finishedOn');
          expect(jobs[0]).to.have.property('processedOn');
          expect(jobs[1]).to.have.property('processedOn');
          await worker.close();
          done();
        } catch (err) {
          done(err);
        }
      }),
    );

    queue.add('test', { foo: 1 });
    queue.add('test', { foo: 2 });
    queue.add('test', { foo: 3 });
  });

  it('should return subset of jobs when setting a negative range', function (done) {
    const worker = new Worker(queueName, async () => {}, {
      connection,
      prefix,
    });

    worker.on(
      'completed',
      after(3, async function () {
        try {
          const jobs = await queue.getJobs('completed', -3, -1, true);
          expect(jobs).to.be.an('array').that.has.length(3);
          expect(jobs[0].data.foo).to.be.equal(1);
          expect(jobs[1].data.foo).to.be.eql(2);
          expect(jobs[2].data.foo).to.be.eql(3);
          await worker.close();
          done();
        } catch (err) {
          done(err);
        }
      }),
    );

    queue.add('test', { foo: 1 });
    queue.add('test', { foo: 2 });
    queue.add('test', { foo: 3 });
  });

  it('should return subset of jobs when range overflows', function (done) {
    const worker = new Worker(queueName, async job => {}, {
      connection,
      prefix,
    });

    worker.on(
      'completed',
      after(3, async function () {
        try {
          const jobs = await queue.getJobs('completed', -300, 99999, true);
          expect(jobs).to.be.an('array').that.has.length(3);
          expect(jobs[0].data.foo).to.be.equal(1);
          expect(jobs[1].data.foo).to.be.eql(2);
          expect(jobs[2].data.foo).to.be.eql(3);
          await worker.close();
          done();
        } catch (err) {
          done(err);
        }
      }),
    );

    queue.add('test', { foo: 1 });
    queue.add('test', { foo: 2 });
    queue.add('test', { foo: 3 });
  });

  it('should return jobs for multiple types', function (done) {
    let counter = 0;
    const worker = new Worker(
      queueName,
      async () => {
        counter++;
        if (counter == 2) {
          await queue.add('test', { foo: 3 });
          return queue.pause();
        }
      },
      { connection, prefix },
    );

    worker.on(
      'completed',
      after(2, async function () {
        try {
          const jobs = await queue.getJobs(['completed', 'waiting']);
          expect(jobs).to.be.an('array');
          expect(jobs).to.have.length(3);
          await worker.close();
          done();
        } catch (err) {
          done(err);
        }
      }),
    );

    queue.add('test', { foo: 1 });
    queue.add('test', { foo: 2 });
  });

  describe('when marker is present', () => {
    describe('when there are delayed jobs and waiting jobs', () => {
      it('filters jobIds different than marker', async () => {
        await queue.add('test1', { foo: 3 }, { delay: 2000 });
        await queue.add('test2', { foo: 2 });

        const jobs = await queue.getJobs(['waiting']);

        expect(jobs).to.be.an('array');
        expect(jobs).to.have.length(1);
        expect(jobs[0].name).to.be.equal('test2');
      });
    });

    describe('when there is only one delayed job and get waiting jobs', () => {
      it('filters marker and returns an empty array', async () => {
        await queue.add('test1', { foo: 3 }, { delay: 2000 });

        const jobs = await queue.getJobs(['waiting']);

        expect(jobs).to.be.an('array');
        expect(jobs).to.have.length(0);
      });
    });
  });

  it('should return deduplicated jobs for duplicates types', async function () {
    await queue.add('test', { foo: 1 });
    const jobs = await queue.getJobs(['wait', 'waiting', 'waiting']);

    expect(jobs).to.be.an('array');
    expect(jobs).to.have.length(1);
  });

  it('should return jobs for all types', function (done) {
    let counter = 0;
    const worker = new Worker(
      queueName,
      async () => {
        counter++;
        if (counter == 2) {
          await queue.add('test', { foo: 3 });
          return queue.pause();
        }
      },
      { connection, prefix },
    );

    worker.on(
      'completed',
      after(2, async function () {
        try {
          const jobs = await queue.getJobs();
          expect(jobs).to.be.an('array');
          expect(jobs).to.have.length(3);
          await worker.close();
          done();
        } catch (err) {
          done(err);
        }
      }),
    );

    queue.add('test', { foo: 1 });
    queue.add('test', { foo: 2 });
  });

  it('should return 0 if queue is empty', async function () {
    const count = await queue.getJobCountByTypes();
    expect(count).to.be.a('number');
    expect(count).to.be.equal(0);
  });

  describe('.getJobCounts', () => {
    it(`returns job counts for active, completed, delayed, failed, paused, prioritized,
    waiting and waiting-children`, async () => {
      await queue.waitUntilReady();

      let fail = true;
      const worker = new Worker(
        queueName,
        async () => {
          await delay(200);
          if (fail) {
            fail = false;
            throw new Error('failed');
          }
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const completing = new Promise<void>(resolve => {
        worker.on('completed', () => {
          resolve();
        });
      });

      const flow = new FlowProducer({ connection, prefix });
      await flow.add({
        name: 'parent-job',
        queueName,
        data: {},
        children: [
          { name: 'child-1', data: { idx: 0, foo: 'bar' }, queueName },
          { name: 'child-2', data: { idx: 1, foo: 'baz' }, queueName },
          { name: 'child-3', data: { idx: 2, foo: 'bac' }, queueName },
          { name: 'child-4', data: { idx: 3, foo: 'bad' }, queueName },
        ],
      });

      await queue.add('test', { idx: 2 }, { delay: 5000 });
      await queue.add('test', { idx: 3 }, { priority: 5 });

      await completing;

      const counts = await queue.getJobCounts();
      expect(counts).to.be.eql({
        active: 1,
        completed: 1,
        delayed: 1,
        failed: 1,
        paused: 0,
        prioritized: 1,
        waiting: 1,
        'waiting-children': 1,
      });

      await worker.close();
      await flow.close();
    });
  });

  describe('.getCountsPerPriority', () => {
    it('returns job counts per priority', async () => {
      await queue.waitUntilReady();

      const jobs = Array.from(Array(42).keys()).map(index => ({
        name: 'test',
        data: {},
        opts: {
          priority: index % 4,
        },
      }));
      await queue.addBulk(jobs);

      const counts = await queue.getCountsPerPriority([0, 1, 2, 3]);

      expect(counts).to.be.eql({
        '0': 11,
        '1': 11,
        '2': 10,
        '3': 10,
      });
    });
  });

  describe('.getDependencies', () => {
    it('return unprocessed jobs that are dependencies of a given parent job', async () => {
      const flowProducer = new FlowProducer({ connection, prefix });
      const flow = await flowProducer.add({
        name: 'parent-job',
        queueName,
        data: {},
        children: [
          { name: 'child-1', data: { idx: 0, foo: 'bar' }, queueName },
          { name: 'child-2', data: { idx: 1, foo: 'baz' }, queueName },
          { name: 'child-3', data: { idx: 2, foo: 'bac' }, queueName },
          { name: 'child-4', data: { idx: 3, foo: 'bad' }, queueName },
        ],
      });

      const result = await queue.getDependencies(
        flow.job.id!,
        'pending',
        0,
        -1,
      );

      expect(result.items).to.be.an('array').that.has.length(4);
      expect(result.jobs).to.be.an('array').that.has.length(4);
      expect(result.total).to.be.equal(4);

      for (const job of result.jobs) {
        expect(job).to.have.property('opts');
        expect(job).to.have.property('data');
        expect(job).to.have.property('delay');
        expect(job).to.have.property('priority');
        expect(job).to.have.property('parent');
        expect(job).to.have.property('parentKey');
        expect(job).to.have.property('name');
        expect(job).to.have.property('timestamp');
      }

      const result2 = await queue.getDependencies(
        flow.job.id!,
        'pending',
        0,
        2,
      );

      expect(result2.items).to.be.an('array').that.has.length(3);
      expect(result2.total).to.be.equal(4);

      await flowProducer.close();
    });

    it('return processed jobs that are dependencies of a given parent job', async () => {
      const flowProducer = new FlowProducer({ connection, prefix });

      const flow = await flowProducer.add({
        name: 'parent-job',
        queueName,
        data: {},
        children: [
          { name: 'child-1', data: { idx: 0, foo: 'bar' }, queueName },
          { name: 'child-2', data: { idx: 1, foo: 'baz' }, queueName },
          { name: 'child-3', data: { idx: 2, foo: 'bac' }, queueName },
          { name: 'child-4', data: { idx: 3, foo: 'bad' }, queueName },
        ],
      });

      const worker = new Worker(queueName, async () => {}, {
        connection,
        prefix,
      });

      let completedChildren = 0;
      const complettingChildren = new Promise<void>(resolve => {
        worker.on('completed', async () => {
          completedChildren++;
          if (completedChildren === 4) {
            resolve();
          }
        });
      });

      await complettingChildren;

      const result = await queue.getDependencies(
        flow.job.id!,
        'pending',
        0,
        -1,
      );

      expect(result.items).to.be.an('array').that.has.length(0);
      expect(result.total).to.be.equal(0);

      const result2 = await queue.getDependencies(
        flow.job.id!,
        'processed',
        0,
        -1,
      );

      expect(result2.items).to.be.an('array').that.has.length(4);
      expect(result2.jobs).to.be.an('array').that.has.length(4);
      expect(result2.total).to.be.equal(4);

      for (const job of result2.jobs) {
        expect(job).to.have.property('opts');
        expect(job).to.have.property('data');
        expect(job).to.have.property('delay');
        expect(job).to.have.property('priority');
        expect(job).to.have.property('parent');
        expect(job).to.have.property('parentKey');
        expect(job).to.have.property('name');
        expect(job).to.have.property('timestamp');
      }

      await worker.close();
      await flowProducer.close();
    });
  });
});
