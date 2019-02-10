import { Queue } from '@src/classes';
import { describe, beforeEach, it } from 'mocha';
import { expect } from 'chai';
import IORedis from 'ioredis';
import { v4 } from 'node-uuid';
import { Worker } from '@src/classes/worker';

describe('workers', function() {
  let queue: Queue;
  let queueName: string;
  let client: IORedis.Redis;

  beforeEach(function() {
    client = new IORedis();
    return client.flushdb();
  });

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
  });

  afterEach(async function() {
    await queue.close();
    return client.quit();
  });

  it('should get all workers for this queue', async function() {
    const worker = new Worker(queueName, async job => {});
    await worker.waitUntilReady();

    const workers = await queue.getWorkers();
    expect(workers).to.have.length(1);
    return worker.close();
  });
});
