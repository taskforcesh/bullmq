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
