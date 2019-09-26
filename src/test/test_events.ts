import { Queue } from '@src/classes';
import { describe, beforeEach, it } from 'mocha';
import { expect } from 'chai';
import IORedis from 'ioredis';
import { v4 } from 'node-uuid';
import { Worker } from '@src/classes/worker';
import { after } from 'lodash';
import { QueueEvents } from '@src/classes/queue-events';

describe('events', function() {
  this.timeout(4000);
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;
  let client: IORedis.Redis;

  beforeEach(function() {
    client = new IORedis();
    return client.flushdb();
  });

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
    queueEvents = new QueueEvents(queueName);
    return queueEvents.waitUntilReady();
  });

  afterEach(async function() {
    await queue.close();
    await queueEvents.close();
    return client.quit();
  });

  it('should emit waiting when a job has been added', function(done) {
    queue.on('waiting', function() {
      done();
    });

    queue.add('test', { foo: 'bar' });
  });

  it('should emit global waiting event when a job has been added', function(done) {
    queueEvents.on('waiting', function() {
      done();
    });

    queue.add('test', { foo: 'bar' });
  });

  /*
  it('should emit stalled when a job has been stalled', function(done) {
    queue.on('completed', function(job) {
      done(new Error('should not have completed'));
    });

    queue.process(function(job) {
      return Bluebird.delay(250);
    });

    queue.add({ foo: 'bar' });

    var queue2 = utils.buildQueue('test events', {
      settings: {
        stalledInterval: 100,
      },
    });

    queue2.on('stalled', function(job) {
      queue2.close().then(done);
    });

    queue.on('active', function() {
      queue2.startMoveUnlockedJobsToWait();
      queue.close(true);
    });
  });

  it('should emit global:stalled when a job has been stalled', function(done) {
    queue.on('completed', function(job) {
      done(new Error('should not have completed'));
    });

    queue.process(function(job) {
      return Bluebird.delay(250);
    });

    queue.add({ foo: 'bar' });

    var queue2 = utils.buildQueue('test events', {
      settings: {
        stalledInterval: 100,
      },
    });

    queue2.on('global:stalled', function(job) {
      queue2.close().then(done);
    });

    queue.on('active', function() {
      queue2.startMoveUnlockedJobsToWait();
      queue.close(true);
    });
  });

  it('emits waiting event when a job is added', function(done) {
    queue.once('waiting', function(jobId) {
      Job.fromId(queue, jobId).then(function(job) {
        expect(job.data.foo).to.be.equal('bar');
        queue.close().then(done);
      });
    });
    queue.once('registered:waiting', function() {
      queue.add({ foo: 'bar' });
    });
  });
  */

  it('emits drained global drained event when all jobs have been processed', async function() {
    const worker = new Worker(queueName, async job => {}, {
      drainDelay: 1,
    });

    const drained = new Promise(resolve => {
      queueEvents.once('drained', resolve);
    });

    await queue.add('test', { foo: 'bar' });
    await queue.add('test', { foo: 'baz' });

    await drained;

    const jobs = await queue.getJobCountByTypes('completed');
    expect(jobs).to.be.equal(2);

    await worker.close();
  });

  it('emits drained event when all jobs have been processed', async function() {
    const worker = new Worker(queueName, async job => {}, {
      drainDelay: 1,
    });

    const drained = new Promise(resolve => {
      worker.once('drained', resolve);
    });

    await queue.add('test', { foo: 'bar' });
    await queue.add('test', { foo: 'baz' });

    await drained;

    const jobs = await queue.getJobCountByTypes('completed');
    expect(jobs).to.be.equal(2);

    await worker.close();
  });

  /*
  it('should emit an event when a new message is added to the queue', function(done) {
    var client = new redis(6379, '127.0.0.1', {});
    client.select(0);
    var queue = new Queue('test pub sub');
    queue.on('waiting', function(jobId) {
      expect(parseInt(jobId, 10)).to.be.eql(1);
      client.quit();
      done();
    });
    queue.once('registered:waiting', function() {
      queue.add({ test: 'stuff' });
    });
  });
*/
  it('should emit an event when a job becomes active', function(done) {
    const worker = new Worker(queueName, async job => {});

    queue.add('test', {});

    worker.once('active', function() {
      worker.once('completed', async function() {
        await worker.close();
        done();
      });
    });
  });

  it('should listen to global events', function(done) {
    const worker = new Worker(queueName, async job => {});

    let state: string;
    queueEvents.on('waiting', function() {
      expect(state).to.be.undefined;
      state = 'waiting';
    });
    queueEvents.once('active', function() {
      expect(state).to.be.equal('waiting');
      state = 'active';
    });
    queueEvents.once('completed', async function() {
      expect(state).to.be.equal('active');
      await worker.close();
      done();
    });

    queue.add('test', {});
  });
});
