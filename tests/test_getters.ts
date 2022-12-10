/*eslint-env node */
'use strict';

import { expect } from 'chai';
import { after } from 'lodash';
import { describe, beforeEach, it } from 'mocha';
import { default as IORedis } from 'ioredis';
import { v4 } from 'uuid';
import { FlowProducer, Queue, QueueEvents, Worker } from '../src/classes';
import { delay, removeAllQueueData } from '../src/utils';

describe('Jobs getters', function () {
  let queue: Queue;
  let queueName: string;
  const connection = { host: 'localhost' };

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection });
  });

  afterEach(async function () {
    await queue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  describe('.getQueueEvents', () => {
    it('gets all queueEvents for this queue', async function () {
      const queueEvent = new QueueEvents(queueName, { connection });
      await queueEvent.waitUntilReady();
      await delay(10);

      const queueEvents = await queue.getQueueEvents();
      expect(queueEvents).to.have.length(1);

      const queueEvent2 = new QueueEvents(queueName, { connection });
      await queueEvent2.waitUntilReady();
      await delay(10);

      const nextQueueEvents = await queue.getQueueEvents();
      expect(nextQueueEvents).to.have.length(2);

      await queueEvent.close();
      await queueEvent2.close();
    });
  });

  describe('.getWorkers', () => {
    it('gets all workers for this queue only', async function () {
      const worker = new Worker(queueName, async () => {}, {
        autorun: false,
        connection,
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
      });
      await new Promise<void>(resolve => {
        worker2.on('ready', () => {
          resolve();
        });
      });

      const nextWorkers = await queue.getWorkers();
      expect(nextWorkers).to.have.length(2);

      await worker.close();
      await worker2.close();
    });

    it('gets only workers related only to one queue', async function () {
      const queueName2 = `${queueName}2`;
      const queue2 = new Queue(queueName2, { connection });
      const worker = new Worker(queueName, async () => {}, {
        autorun: false,
        connection,
      });
      await new Promise<void>(resolve => {
        worker.on('ready', () => {
          resolve();
        });
      });
      const worker2 = new Worker(queueName2, async () => {}, {
        autorun: false,
        connection,
      });
      await new Promise<void>(resolve => {
        worker2.on('ready', () => {
          resolve();
        });
      });

      const workers = await queue.getWorkers();
      expect(workers).to.have.length(1);

      const workers2 = await queue2.getWorkers();
      expect(workers2).to.have.length(1);

      await queue2.close();
      await worker.close();
      await worker2.close();
      await removeAllQueueData(new IORedis(), queueName2);
    });

    describe('when sharing connection', () => {
      it('gets same reference for all workers for same queue', async function () {
        const ioredisConnection = new IORedis({ maxRetriesPerRequest: null });
        const worker = new Worker(queueName, async () => {}, {
          autorun: false,
          connection: ioredisConnection,
        });
        await new Promise<void>(resolve => {
          worker.on('ready', () => {
            resolve();
          });
        });

        const workers = await queue.getWorkers();
        expect(workers).to.have.length(1);

        const worker2 = new Worker(queueName, async () => {}, {
          connection: ioredisConnection,
        });
        await worker2.waitUntilReady();

        const nextWorkers = await queue.getWorkers();
        expect(nextWorkers).to.have.length(1);

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
    const worker = new Worker(queueName, processor, { connection });

    await queue.add('test', { foo: 'bar' });
    await processing;

    await worker.close();
  });

  it('should get a specific job', async () => {
    const data = { foo: 'sup!' };
    const job = await queue.add('test', data);
    const returnedJob = await queue.getJob(job.id);
    expect(returnedJob.data).to.eql(data);
    expect(returnedJob.id).to.be.eql(job.id);
  });

  it('should get undefined for nonexistent specific job', async () => {
    const returnedJob = await queue.getJob('test');
    expect(returnedJob).to.be.equal(undefined);
  });

  it('should get completed jobs', async () => {
    const worker = new Worker(queueName, async () => {}, { connection });
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
      { connection },
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

  it('should get all failed jobs when no range is provided', async () => {
    const worker = new Worker(
      queueName,
      async () => {
        throw new Error('Forced error');
      },
      { connection },
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
    const worker = new Worker(queueName, async () => {}, { connection });

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
      { connection },
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
    const worker = new Worker(queueName, async () => {}, { connection });

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
    const worker = new Worker(queueName, async () => {}, { connection });

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
    const worker = new Worker(queueName, async job => {}, { connection });

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
      { connection },
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
      { connection },
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
    it('returns job counts for active, completed, delayed, failed, paused, waiting and waiting-children', async () => {
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
        { connection },
      );
      await worker.waitUntilReady();

      const completing = new Promise<void>(resolve => {
        worker.on('completed', () => {
          resolve();
        });
      });

      const flow = new FlowProducer({ connection });
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

      await completing;

      const counts = await queue.getJobCounts();
      expect(counts).to.be.eql({
        active: 1,
        completed: 1,
        delayed: 1,
        failed: 1,
        paused: 0,
        waiting: 1,
        'waiting-children': 1,
      });

      await worker.close();
      await flow.close();
    });
  });
});
