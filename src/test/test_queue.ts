/*
import { Queue } from '@src/classes';
import { describe, beforeEach, it } from 'mocha';
import { expect, assert } from 'chai';
import * as IORedis from 'ioredis';
import { v4 } from 'uuid';
import { Worker } from '@src/classes/worker';
import { after } from 'lodash';
import { QueueEvents } from '@src/classes/queue-events';
import { QueueScheduler } from '@src/classes/queue-scheduler';

describe('Queue', function() {
  let queue: Queue;
  let queueName: string;
  let queueEvents: QueueEvents;

  beforeEach(function() {
    client = new IORedis();
  });

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
    queueEvents = new QueueEvents(queueName);
    await queueEvents.init();
  });

  afterEach(async function() {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('creates a queue with default job options', () => {
    const defaultJobOptions = { removeOnComplete: true };
    const queue = new Queue('custom', {
      defaultJobOptions,
    });

    expect(queue.defaultJobOptions).to.be.eql(defaultJobOptions);
  });

  describe('bulk jobs', () => {
    it('should default name of job', () => {
      const queue = new Queue('custom');

      return queue.addBulk([{ name: 'specified' }, {}]).then(jobs => {
        expect(jobs).to.have.length(2);

        expect(jobs[0].name).to.equal('specified');
        expect(jobs[1].name).to.equal('__default__');
      });
    });

    it('should default options from queue', () => {
      const queue = new Queue('custom', {
        defaultJobOptions: {
          removeOnComplete: true,
        },
      });

      return queue.addBulk([{}]).then(jobs => {
        expect(jobs[0].opts.removeOnComplete).to.equal(true);
      });
    });
  });
});
*/

import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { describe, beforeEach, it } from 'mocha';
import * as sinon from 'sinon';
import { v4 } from 'uuid';
import { Queue, QueueScheduler } from '../classes';
import { removeAllQueueData } from '../utils';

describe('queues', function() {
  const sandbox = sinon.createSandbox();

  let queue: Queue;
  let queueName: string;

  beforeEach(async function() {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName);
    await queue.waitUntilReady();
  });

  afterEach(async function() {
    sandbox.restore();
    await queue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  describe('.drain', () => {
    it('count added, unprocessed jobs', async () => {
      const maxJobs = 100;
      const added = [];

      for (let i = 1; i <= maxJobs; i++) {
        added.push(queue.add('test', { foo: 'bar', num: i }));
      }

      await Promise.all(added);
      const count = await queue.count();
      expect(count).to.be.eql(maxJobs);
      await queue.drain();
      const countAfterEmpty = await queue.count();
      expect(countAfterEmpty).to.be.eql(0);
    });

    describe('when delayed option is provided as false', () => {
      it('clean queue without delayed jobs', async () => {
        const maxJobs = 50;
        const maxDelayedJobs = 50;
        const added = [];
        const delayed = [];

        const queueScheduler = new QueueScheduler(queueName);
        await queueScheduler.waitUntilReady();

        for (let i = 1; i <= maxJobs; i++) {
          added.push(queue.add('test', { foo: 'bar', num: i }));
        }

        for (let i = 1; i <= maxDelayedJobs; i++) {
          delayed.push(
            queue.add('test', { foo: 'bar', num: i }, { delay: 10000 }),
          );
        }

        await Promise.all(added);
        await Promise.all(delayed);
        const count = await queue.count();
        expect(count).to.be.eql(maxJobs + maxDelayedJobs);
        await queue.drain(false);
        const countAfterEmpty = await queue.count();
        expect(countAfterEmpty).to.be.eql(50);
        await queueScheduler.close();
      });
    });

    describe('when delayed option is provided as true', () => {
      it('clean queue including delayed jobs', async () => {
        const maxJobs = 50;
        const maxDelayedJobs = 50;
        const added = [];
        const delayed = [];

        const queueScheduler = new QueueScheduler(queueName);
        await queueScheduler.waitUntilReady();

        for (let i = 1; i <= maxJobs; i++) {
          added.push(queue.add('test', { foo: 'bar', num: i }));
        }

        for (let i = 1; i <= maxDelayedJobs; i++) {
          delayed.push(
            queue.add('test', { foo: 'bar', num: i }, { delay: 10000 }),
          );
        }

        await Promise.all(added);
        await Promise.all(delayed);
        const count = await queue.count();
        expect(count).to.be.eql(maxJobs + maxDelayedJobs);
        await queue.drain(true);
        const countAfterEmpty = await queue.count();
        expect(countAfterEmpty).to.be.eql(0);
        await queueScheduler.close();
      });
    });

    describe('when queue is paused', () => {
      it('clean queue including paused jobs', async () => {
        const maxJobs = 50;
        const added = [];

        await queue.pause();
        for (let i = 1; i <= maxJobs; i++) {
          added.push(queue.add('test', { foo: 'bar', num: i }));
        }

        await Promise.all(added);
        const count = await queue.count();
        expect(count).to.be.eql(maxJobs);
        const count2 = await queue.getJobCounts('paused');
        expect(count2.paused).to.be.eql(maxJobs);
        await queue.drain();
        const countAfterEmpty = await queue.count();
        expect(countAfterEmpty).to.be.eql(0);
      });
    });
  });
});
