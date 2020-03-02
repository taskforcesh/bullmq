/*eslint-env node */
/* tslint:disable: no-floating-promises */
'use strict';

import { Job, Worker } from '@src/classes';
import { Queue3 } from '@src/classes/compat';
import { delay, removeAllQueueData } from '@src/utils';
import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { after } from 'lodash';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';

describe('Compat', function() {
  describe('jobs getters', function() {
    this.timeout(4000);
    let queue: Queue3;
    let queueName: string;

    beforeEach(async function() {
      queueName = 'test-' + v4();
      queue = new Queue3(queueName);
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
      const processing = new Promise(resolve => {
        processor = async (job: Job) => {
          const jobs = await queue.getActive();
          expect(jobs).to.be.a('array');
          expect(jobs.length).to.be.equal(1);
          expect(jobs[0].data.foo).to.be.equal('bar');
          resolve();
        };
      });

      await queue.add('test', { foo: 'bar' });
      await queue.process(processor);
      await processing;
    });

    it('should get completed jobs', function(done) {
      queue.process(async job => {});

      let counter = 2;

      queue.on('completed', async function() {
        counter--;

        if (counter === 0) {
          const jobs = await queue.getCompleted();
          expect(jobs).to.be.a('array');
          done();
        }
      });

      queue.add('test', { foo: 'bar' });
      queue.add('test', { baz: 'qux' });
    });

    it('should get failed jobs', function(done) {
      queue.process(async job => {
        throw new Error('Forced error');
      });

      let counter = 2;

      queue.on('failed', async function() {
        counter--;

        if (counter === 0) {
          const jobs = await queue.getFailed();
          expect(jobs).to.be.a('array');
          done();
        }
      });

      queue.add('test', { foo: 'bar' });
      queue.add('test', { baz: 'qux' });
    });

    it('should return all completed jobs when not setting start/end', function(done) {
      queue.process(async job => {});

      queue.on(
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

    it('should return all failed jobs when not setting start/end', function(done) {
      queue.process(async job => {
        throw new Error('error');
      });

      queue.on(
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
      queue.process(async job => {});

      queue.on(
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
      queue.process(async job => {});

      queue.on(
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
      queue.process(async job => {});

      queue.on(
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

      queue.process(async job => {
        counter++;
        if (counter == 2) {
          await queue.add('test', { foo: 3 });
          return queue.pause();
        }
      });

      queue.on(
        'completed',
        after(2, async function() {
          try {
            const jobs = await queue.getJobs(['completed', 'waiting']);
            expect(jobs).to.be.an('array');
            expect(jobs).to.have.length(3);
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

  describe('events', function() {
    this.timeout(4000);
    let queue: Queue3;
    let queueName: string;

    beforeEach(async function() {
      queueName = 'test-' + v4();
      queue = new Queue3(queueName);
    });

    afterEach(async function() {
      await queue.close();
      await removeAllQueueData(new IORedis(), queueName);
    });

    it('should emit waiting when a job has been added', function(done) {
      queue.on('waiting', function() {
        done();
      });

      queue.add('test', { foo: 'bar' });
    });

    it('should emit global waiting event when a job has been added', function(done) {
      queue.on('waiting', function() {
        done();
      });

      queue.add('test', { foo: 'bar' });
    });

    it('emits drained event when all jobs have been processed', async function() {
      await queue.add('test', { foo: 'bar' });
      await queue.add('test', { foo: 'baz' });

      queue.process(async job => {});

      const drained = new Promise(resolve => {
        queue.once('drained', resolve);
      });

      await drained;

      const jobs = await queue.getJobCountByTypes('completed');
      expect(jobs).to.be.equal(2);
    });

    it('emits drained event when all jobs have been processed', async function() {
      await queue.add('test', { foo: 'bar' });
      await queue.add('test', { foo: 'baz' });

      queue.process(async job => {});

      const drained = new Promise(resolve => {
        queue.once('global:drained', resolve);
      });

      await drained;

      const jobs = await queue.getJobCountByTypes('completed');
      expect(jobs).to.be.equal(2);
    });

    it('should emit an event when a job becomes active', function(done) {
      queue.add('test', {});

      queue.process(async () => {});

      queue.once('active', function() {
        queue.once('completed', async function() {
          done();
        });
      });
    });

    it('should listen to global events with .once', async function() {
      const events: string[] = [];
      queue.once('global:waiting', () => events.push('waiting'));
      queue.once('global:active', () => events.push('active'));
      queue.once('global:completed', () => events.push('completed'));
      await queue.isReady();
      await queue.add('test', {});
      await queue.add('test', {});
      await queue.process(() => null);
      await delay(50);
      expect(events).to.eql(['waiting', 'active', 'completed']);
    });

    it('should listen to global events with .on', async function() {
      const events: string[] = [];
      queue.on('global:waiting', () => events.push('waiting'));
      queue.on('global:active', () => events.push('active'));
      queue.on('global:completed', () => events.push('completed'));
      await queue.isReady();
      await delay(50); // additional delay since XREAD from '$' is unstable
      await queue.add('test', {});
      await queue.add('test', {});
      await queue.process(() => null);
      await delay(50);
      expect(events).to.eql([
        'waiting',
        'waiting',
        'active',
        'completed',
        'active',
        'completed',
      ]);
    });
  });

  describe('Pause', function() {
    let queue: Queue3;
    let queueName: string;

    beforeEach(async function() {
      queueName = 'test-' + v4();
      queue = new Queue3(queueName);
    });

    afterEach(async function() {
      await queue.close();
      await removeAllQueueData(new IORedis(), queueName);
    });

    // it('should pause a queue until resumed', async () => {
    //   let process;
    //   let isPaused = false;
    //   let counter = 2;
    //   const processPromise = new Promise(resolve => {
    //     process = async (job: Job) => {
    //       expect(isPaused).to.be.eql(false);
    //       expect(job.data.foo).to.be.equal('paused');
    //       counter--;
    //       if (counter === 0) {
    //         resolve();
    //       }
    //     };
    //   });
    //
    //   await queue.process(process);
    //
    //   await queue.pause();
    //   isPaused = true;
    //   await queue.add('test', { foo: 'paused' });
    //   await queue.add('test', { foo: 'paused' });
    //   isPaused = false;
    //   await queue.resume();
    //
    //   await processPromise;
    // });

    it('should be able to pause a running queue and emit relevant events', async () => {
      let process;

      let isPaused = false,
        isResumed = true,
        first = true;

      queue.on('global:paused', async () => {
        isPaused = false;
        await queue.resume();
      });

      queue.on('global:resumed', () => {
        isResumed = true;
      });

      await queue.queueEvents.waitUntilReady();

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
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        };
      });

      await queue.process(process);

      queue.add('test', { foo: 'paused' });
      queue.add('test', { foo: 'paused' });

      return processPromise;
    });

    it('should pause the queue locally', async () => {
      let counter = 2;
      let process;
      const processPromise = new Promise(resolve => {
        process = async (job: Job) => {
          expect(queue.isWorkerPaused()).to.be.eql(false);
          counter--;
          if (counter === 0) {
            resolve();
          }
        };
      });

      await queue.process(process);
      await queue.pauseWorker();

      // Add the worker after the queue is in paused mode since the normal behavior is to pause
      // it after the current lock expires. This way, we can ensure there isn't a lock already
      // to test that pausing behavior works.

      await queue.add('test', { foo: 'paused' });
      await queue.add('test', { foo: 'paused' });

      expect(counter).to.be.eql(2);
      expect(queue.isWorkerPaused()).to.be.eql(true);

      await queue.resumeWorker();
      return processPromise;
    });

    // it('should wait until active jobs are finished before resolving pause', async () => {
    //   let process;
    //
    //   const startProcessing = new Promise(resolve => {
    //     process = async () => {
    //       resolve();
    //       return delay(1000);
    //     };
    //   });
    //
    //   await queue.process(process);
    //
    //   const jobs = [];
    //   for (let i = 0; i < 10; i++) {
    //     jobs.push(queue.add('test', i));
    //   }
    //
    //   //
    //   // Add start processing so that we can test that pause waits for this job to be completed.
    //   //
    //   jobs.push(startProcessing);
    //   await Promise.all(jobs);
    //   await queue.pause(true);
    //
    //   let active = await queue.getJobCountByTypes('active');
    //   expect(active).to.be.eql(0);
    //   expect(queue.isPaused()).to.be.eql(true);
    //
    //   // One job from the 10 posted above will be processed, so we expect 9 jobs pending
    //   let paused = await queue.getJobCountByTypes('delayed', 'waiting');
    //   expect(paused).to.be.eql(9);
    //   await Promise.all([active, paused]);
    //
    //   await queue.add('test', {});
    //
    //   active = await queue.getJobCountByTypes('active');
    //   expect(active).to.be.eql(0);
    //
    //   paused = await queue.getJobCountByTypes('paused', 'waiting', 'delayed');
    //   expect(paused).to.be.eql(10);
    //
    //   await Promise.all([active, paused]);
    // });

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

      queue.add('test', 1);
      queue.add('test', 2);
      queue.add('test', 3);
      queue.add('test', 4);

      await Promise.all([startProcessing1, startProcessing2]);
      await Promise.all([worker1.pause(), worker2.pause()]);

      const count = await queue.getJobCounts('active', 'waiting', 'completed');
      expect(count.active).to.be.eql(0);
      expect(count.waiting).to.be.eql(2);
      expect(count.completed).to.be.eql(2);

      return Promise.all([worker1.close(), worker2.close()]);
    });

    // it('should wait for blocking job retrieval to complete before pausing locally', async () => {
    //   let process;
    //
    //   const startProcessing = new Promise(resolve => {
    //     process = async () => {
    //       resolve();
    //       return delay(200);
    //     };
    //   });
    //
    //   await queue.process(process);
    //
    //   await queue.add('test', 1);
    //   await startProcessing;
    //   await queue.pause(true);
    //   await queue.add('test', 2);
    //
    //   const count = await queue.getJobCounts('active', 'waiting', 'completed');
    //   expect(count.active).to.be.eql(0);
    //   expect(count.waiting).to.be.eql(1);
    //   expect(count.completed).to.be.eql(1);
    // });

    it('pauses fast when queue is drained', async function() {
      await queue.process(async () => {});

      const promise = new Promise((resolve, reject) => {
        queue.on('global:drained', async () => {
          try {
            const start = new Date().getTime();
            await queue.pause();

            const finish = new Date().getTime();
            expect(finish - start).to.be.lt(1000);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.queueEvents.waitUntilReady();

      await queue.add('test', {});
      return promise;
    });
  });
});
