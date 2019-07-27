import { Queue } from '@src/classes';
import { describe, beforeEach, it } from 'mocha';
import { expect, assert } from 'chai';
import IORedis from 'ioredis';
import { v4 } from 'node-uuid';
import { Worker } from '@src/classes/worker';
import { after } from 'lodash';
import { QueueEvents } from '@src/classes/queue-events';
import { QueueScheduler } from '@src/classes/queue-scheduler';

describe('Rate Limiter', function() {
  let queue: Queue;
  let queueName: string;
  let queueEvents: QueueEvents;
  let client: IORedis.Redis;

  beforeEach(function() {
    client = new IORedis();
    return client.flushdb();
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
    return client.quit();
  });

  it('should put a job into the delayed queue when limit is hit', async () => {
    const worker = new Worker(queueName, async job => {}, {
      limiter: {
        max: 1,
        duration: 1000,
      },
    });
    await worker.waitUntilReady();

    queueEvents.on('failed', err => {
      assert.fail(err);
    });

    await Promise.all([
      queue.append('test', {}),
      queue.append('test', {}),
      queue.append('test', {}),
      queue.append('test', {}),
    ]);

    await Promise.all([
      worker.getNextJob(),
      worker.getNextJob(),
      worker.getNextJob(),
      worker.getNextJob(),
    ]);

    const delayedCount = await queue.getDelayedCount();
    expect(delayedCount).to.eq(3);
  });

  it('should obey the rate limit', async function() {
    this.timeout(20000);

    const numJobs = 4;
    const startTime = new Date().getTime();

    const queueKeeper = new QueueScheduler(queueName);
    await queueKeeper.init();

    const worker = new Worker(queueName, async job => {}, {
      limiter: {
        max: 1,
        duration: 1000,
      },
    });

    const result = new Promise((resolve, reject) => {
      queueEvents.on(
        'completed',
        // after every job has been completed
        after(numJobs, async () => {
          await worker.close();

          try {
            const timeDiff = new Date().getTime() - startTime;
            expect(timeDiff).to.be.above((numJobs - 1) * 1000);
            resolve();
          } catch (err) {
            reject(err);
          }
        }),
      );

      queueEvents.on('failed', async err => {
        await worker.close();
        reject(err);
      });
    });

    for (let i = 0; i < numJobs; i++) {
      await queue.append('rate test', {});
    }

    await result;
    await worker.close();
    await queueKeeper.close();
  });
});
