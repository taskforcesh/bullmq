/*eslint-env node */
'use strict';

import { Queue } from '@src/classes';
import { describe, beforeEach, it } from 'mocha';
import { expect } from 'chai';
import IORedis from 'ioredis';
import { v4 } from 'node-uuid';
import { Worker } from '@src/classes/worker';
import { after } from 'lodash';

describe('Jobs getters', function() {
  this.timeout(4000);
  let queue: Queue;
  let queueName: string;
  let client: IORedis.Redis;

  beforeEach(function() {
    client = new IORedis();
    return client.flushdb();
  });

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName, {
      connection: { port: 6379, host: '127.0.0.1' },
    });
  });

  afterEach(async function() {
    await queue.close();
    return client.quit();
  });

  it('should get waiting jobs', async function() {
    await queue.append('test', { foo: 'bar' });
    await queue.append('test', { baz: 'qux' });

    const jobs = await queue.getWaiting();
    expect(jobs).to.be.a('array');
    expect(jobs.length).to.be.equal(2);
    expect(jobs[0].data.foo).to.be.equal('bar');
    expect(jobs[1].data.baz).to.be.equal('qux');
  });

  it('should get paused jobs', async function() {
    await queue.pause();
    await Promise.all([
      queue.append('test', { foo: 'bar' }),
      queue.append('test', { baz: 'qux' }),
    ]);
    const jobs = await queue.getWaiting();
    expect(jobs).to.be.a('array');
    expect(jobs.length).to.be.equal(2);
    expect(jobs[0].data.foo).to.be.equal('bar');
    expect(jobs[1].data.baz).to.be.equal('qux');
  });

  it('should get active jobs', async function() {
    const worker = new Worker(queueName, async job => {
      const jobs = await queue.getActive();
      expect(jobs).to.be.a('array');
      expect(jobs.length).to.be.equal(1);
      expect(jobs[0].data.foo).to.be.equal('bar');
    });

    queue.append('test', { foo: 'bar' });

    await worker.close();
  });

  /*
  it('should get a specific job', function(done) {
    var data = { foo: 'sup!' };
    queue.add(data).then(function(job) {
      queue.getJob(job.id).then(function(returnedJob) {
        expect(returnedJob.data).to.eql(data);
        expect(returnedJob.id).to.be.eql(job.id);
        done();
      });
    });
  });
  */

  it('should get completed jobs', function(done) {
    const worker = new Worker(queueName, async job => {});
    let counter = 2;

    worker.on('completed', async function() {
      counter--;

      if (counter === 0) {
        const jobs = await queue.getCompleted();
        expect(jobs).to.be.a('array');

        // We need a "empty completed" kind of function.
        //expect(jobs.length).to.be.equal(2);
        await worker.close();
        done();
      }
    });

    queue.append('test', { foo: 'bar' });
    queue.append('test', { baz: 'qux' });
  });

  it('should get failed jobs', function(done) {
    const worker = new Worker(queueName, async job => {
      throw new Error('Forced error');
    });

    let counter = 2;

    worker.on('failed', async function() {
      counter--;

      if (counter === 0) {
        const jobs = await queue.getFailed();
        expect(jobs).to.be.a('array');
        await worker.close();
        done();
      }
    });

    queue.append('test', { foo: 'bar' });
    queue.append('test', { baz: 'qux' });
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
          expect(jobs)
            .to.be.an('array')
            .that.have.length(3);
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

    queue.append('test', { foo: 1 });
    queue.append('test', { foo: 2 });
    queue.append('test', { foo: 3 });
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
          expect(jobs)
            .to.be.an('array')
            .that.has.length(3);
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

    queue.append('test', { foo: 1 });
    queue.append('test', { foo: 2 });
    queue.append('test', { foo: 3 });
  });

  it('should return subset of jobs when setting positive range', function(done) {
    const worker = new Worker(queueName, async job => {});

    worker.on(
      'completed',
      after(3, async function() {
        try {
          const jobs = await queue.getJobs('completed', 1, 2, true);
          expect(jobs)
            .to.be.an('array')
            .that.has.length(2);
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

    queue.append('test', { foo: 1 });
    queue.append('test', { foo: 2 });
    queue.append('test', { foo: 3 });
  });

  it('should return subset of jobs when setting a negative range', function(done) {
    const worker = new Worker(queueName, async job => {});

    worker.on(
      'completed',
      after(3, async function() {
        try {
          const jobs = await queue.getJobs('completed', -3, -1, true);
          expect(jobs)
            .to.be.an('array')
            .that.has.length(3);
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

    queue.append('test', { foo: 1 });
    queue.append('test', { foo: 2 });
    queue.append('test', { foo: 3 });
  });

  it('should return subset of jobs when range overflows', function(done) {
    const worker = new Worker(queueName, async job => {});

    worker.on(
      'completed',
      after(3, async function() {
        try {
          const jobs = await queue.getJobs('completed', -300, 99999, true);
          expect(jobs)
            .to.be.an('array')
            .that.has.length(3);
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

    queue.append('test', { foo: 1 });
    queue.append('test', { foo: 2 });
    queue.append('test', { foo: 3 });
  });

  it('should return jobs for multiple types', function(done) {
    let counter = 0;
    const worker = new Worker(queueName, async job => {
      counter++;
      if (counter == 2) {
        await queue.append('test', { foo: 3 });
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

    queue.append('test', { foo: 1 });
    queue.append('test', { foo: 2 });
  });
});
