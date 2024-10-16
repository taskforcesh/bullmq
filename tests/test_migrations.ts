import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { describe, beforeEach, it, before, after as afterAll } from 'mocha';
import * as sinon from 'sinon';
import { v4 } from 'uuid';
import { Queue } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('migrations', function () {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  const sandbox = sinon.createSandbox();

  let queue: Queue;
  let queueName: string;

  let connection;
  before(async function () {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
    await queue.waitUntilReady();
  });

  afterEach(async function () {
    sandbox.restore();
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('execute migrations', () => {
    describe('removeLegacyMarkers', () => {
      it('removes old markers', async () => {
        const client = await queue.client;
        const queueName2 = `test-${v4()}`;
        const completedKey = `${prefix}:${queueName2}:completed`;
        const failedKey = `${prefix}:${queueName2}:failed`;
        const waitingKey = `${prefix}:${queueName2}:wait`;
        await client.zadd(completedKey, 1, '0:2');
        await client.zadd(completedKey, 1, '0:2');
        await client.zadd(failedKey, 2, '0:1');
        await client.rpush(waitingKey, '0:0');

        const queue2 = new Queue(queueName2, { connection, prefix });

        await queue2.waitUntilReady();

        await queue2.waitUntilReady();

        const keys = await client.keys(`${prefix}:${queueName2}:*`);

        // meta key, migrations
        expect(keys.length).to.be.eql(2);

        const completedCount = await client.zcard(completedKey);
        expect(completedCount).to.be.eql(0);

        const failedCount = await client.zcard(failedKey);
        expect(failedCount).to.be.eql(0);

        const waitingCount = await client.llen(waitingKey);
        expect(waitingCount).to.be.eql(0);

        await queue2.close();
        await removeAllQueueData(new IORedis(redisHost), queueName2);
      });
    });

    describe('migratePausedKey', () => {
      it('moves jobs from paused to wait', async () => {
        const client = await queue.client;
        const queueName2 = `test-${v4()}`;
        await client.lpush(`${prefix}:${queueName2}:paused`, 'a', 'b', 'c');
        await client.lpush(`${prefix}:${queueName2}:wait`, 'd', 'e', 'f');

        const queue2 = new Queue(queueName2, { connection, prefix });

        await queue2.waitUntilReady();

        const jobs = await client.lrange(`${prefix}:${queueName2}:wait`, 0, -1);

        expect(jobs).to.be.eql(['f', 'e', 'd', 'c', 'b', 'a']);
        await queue2.close();
        await removeAllQueueData(new IORedis(redisHost), queueName2);
      });
    });
  });
});
