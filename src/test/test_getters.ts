/*eslint-env node */
'use strict';

import { expect } from 'chai';
import { after } from 'lodash';
import { describe, beforeEach, it } from 'mocha';
import * as IORedis from 'ioredis';
import { v4 } from 'uuid';
import { Queue, Job, Worker } from '../classes';
import { removeAllQueueData } from '../utils';

describe('Jobs getters', function() {
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

  it('should get waiting jobs', async function() {
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

  it('should get paused jobs', async function() {
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

  it('should get active jobs', async function() {
    let processor;
    const processing = new Promise<void>(resolve => {
      processor = async (job: Job) => {
        const jobs = await queue.getActive();
        expect(jobs).to.be.a('array');
        expect(jobs.length).to.be.equal(1);
        expect(jobs[0].data.foo).to.be.equal('bar');
        resolve();
      };
    });
    const worker = new Worker(queueName, processor);

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
    const worker = new Worker(queueName, async job => {});
    let counter = 2;

    const completed = new Promise<void>(resolve => {
      worker.on('completed', async function() {
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
    const worker = new Worker(queueName, async job => {
      throw new Error('Forced error');
    });

    let counter = 2;

    const failed = new Promise<void>(resolve => {
      worker.on('failed', async function() {
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
    const worker = new Worker(queueName, async job => {
      throw new Error('Forced error');
    });

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

  it('should return all completed jobs when not setting start/end', function(done) {
    const worker = new Worker(queueName, async job => {});

    worker.on(
      'completed',
      after(3, async function() {
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

  it('should return all failed jobs when not setting start/end', function(done) {
    const worker = new Worker(queueName, async job => {
      throw new Error('error');
    });

    worker.on(
      'failed',
      after(3, async function() {
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

  it('should return subset of jobs when setting positive range', function(done) {
    const worker = new Worker(queueName, async job => {});

    worker.on(
      'completed',
      after(3, async function() {
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

  it('should return subset of jobs when setting a negative range', function(done) {
    const worker = new Worker(queueName, async job => {});

    worker.on(
      'completed',
      after(3, async function() {
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

  it('should return subset of jobs when range overflows', function(done) {
    const worker = new Worker(queueName, async job => {});

    worker.on(
      'completed',
      after(3, async function() {
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

  it('should return jobs for multiple types', function(done) {
    let counter = 0;
    const worker = new Worker(queueName, async job => {
      counter++;
      if (counter == 2) {
        await queue.add('test', { foo: 3 });
        return queue.pause();
      }
    });

    worker.on(
      'completed',
      after(2, async function() {
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
});
