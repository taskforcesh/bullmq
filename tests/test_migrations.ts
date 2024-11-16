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
        const completedKey = `${prefix}:${queueName}:completed`;
        const failedKey = `${prefix}:${queueName}:failed`;
        const waitingKey = `${prefix}:${queueName}:wait`;
        await client.zadd(completedKey, 1, '0:2');
        await client.zadd(completedKey, 1, '0:2');
        await client.zadd(failedKey, 2, '0:1');
        await client.rpush(waitingKey, '0:0');

        await queue.runMigrations();

        const keys = await client.keys(`${prefix}:${queueName}:*`);

        // meta key, migrations
        expect(keys.length).to.be.eql(2);

        const completedCount = await client.zcard(completedKey);
        expect(completedCount).to.be.eql(0);

        const failedCount = await client.zcard(failedKey);
        expect(failedCount).to.be.eql(0);

        const waitingCount = await client.llen(waitingKey);
        expect(waitingCount).to.be.eql(0);
      });
    });

    describe('migratePausedKey', () => {
      it('moves jobs from paused to wait', async () => {
        const client = await queue.client;
        await client.lpush(
          `${prefix}:${queueName}:paused`,
          '1',
          '2',
          '3',
          '4',
          '5',
          '6',
        );

        await queue.runMigrations();

        const jobs = await client.lrange(`${prefix}:${queueName}:wait`, 0, -1);

        expect(jobs).to.be.eql(['6', '5', '4', '3', '2', '1']);
      });
    });
  });
});
