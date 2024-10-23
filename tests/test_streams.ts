import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { after as afterAll, before, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { delay, FanoutWorker, Producer, Queue } from '../src';
import { Consumer } from '../src/classes/consumer';

describe('streams', function () {
  const redisHost = process.env.REDIS_HOST || 'localhost';

  let consumerConnection: IORedis;
  let generalConnection: IORedis;
  before(async function () {
    consumerConnection = new IORedis(redisHost, { maxRetriesPerRequest: null });
    generalConnection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  afterAll(async function () {
    await consumerConnection.quit();
    await generalConnection.quit();
  });

  describe('when consuming', () => {
    it('trim to retention', async () => {
      const streamName = `test-${v4()}`;
      const consumerGroup = `test-${v4()}`;
      const producer = new Producer(streamName, {
        connection: generalConnection,
      });
      const consumer = new Consumer(streamName, {
        connection: consumerConnection,
        maxRetentionMs: 100,
        trimIntervalMs: 100,
      });
      const jobs = 10;
      const processed: any[] = [];
      consumer.consume(consumerGroup, async job => {
        processed.push(job);
      });

      for (let iterations = 0; iterations < 5; iterations++) {
        for (let i = 1; i <= jobs; i++) {
          await producer.produce({ idx: i });
        }
        const length = await consumer.getLength();
        expect(length).to.be.lte(jobs * 2); // trimming is not exact but it does happen
        await delay(1000);
      }

      await consumer.close();
    }).timeout(10000);
  });

  describe('when jobs produced with an active consumer', () => {
    it('should process the jobs', async () => {
      const streamName = `test-${v4()}`;
      const consumerGroup = `test-${v4()}`;
      const producer = new Producer(streamName, {
        connection: generalConnection,
      });
      const consumer = new Consumer(streamName, {
        connection: consumerConnection,
      });
      const jobs = 10;
      const processed: any[] = [];
      consumer.consume(consumerGroup, async job => {
        processed.push(job);
      });

      for (let i = 1; i <= jobs; i++) {
        await producer.produce({ idx: i });
      }
      while (processed.length < jobs) {
        await delay(50);
      }
      expect(processed.length).to.be.eql(jobs);
      expect(processed.map(job => job.idx)).to.be.eql(
        Array.from(Array(jobs).keys()).map(i => i + 1),
      );
      await consumer.close();
    }).timeout(10000);
  });

  describe('when jobs produced with a late consumer', () => {
    it('should process the jobs', async () => {
      const streamName = `test-${v4()}`;
      const consumerGroup = `test-${v4()}`;
      const producer = new Producer(streamName, {
        connection: generalConnection,
      });
      const consumer = new Consumer(streamName, {
        connection: consumerConnection,
      });
      const jobs = 10;
      const processed: any[] = [];

      for (let i = 1; i <= jobs / 2; i++) {
        await producer.produce({ idx: i });
      }
      consumer.consume(consumerGroup, async job => {
        processed.push(job);
      });
      for (let i = jobs / 2 + 1; i <= jobs; i++) {
        await producer.produce({ idx: i });
      }
      while (processed.length < jobs) {
        await delay(50);
      }
      expect(processed.length).to.be.eql(jobs);
      expect(processed.map(job => job.idx)).to.be.eql(
        Array.from(Array(jobs).keys()).map(i => i + 1),
      );
      await consumer.close();
    }).timeout(10000);
  });

  describe('when jobs produced with an active fanout', () => {
    it('should fanout to defined queues', async () => {
      const streamName = `test-${v4()}`;
      const producer = new Producer(streamName, {
        connection: generalConnection,
      });
      const fanout = new FanoutWorker(streamName, {
        connection: consumerConnection,
      });
      const queues = [
        new Queue(`test-${v4()}`, { connection: generalConnection }),
        new Queue(`test-${v4()}`, { connection: generalConnection }),
      ];
      const jobs = 10;

      fanout.fanout(queues).then();

      for (let i = 1; i <= jobs; i++) {
        await producer.produce({ idx: i });
      }
      while ((await queues[1].count()) < jobs) {
        await delay(50);
      }
      for (const queue of queues) {
        expect(await queue.count()).to.be.eql(jobs);
        expect((await queue.getWaiting()).map(job => job.data.idx)).to.be.eql(
          Array.from(Array(jobs).keys()).map(i => i + 1),
        );
      }
      await fanout.close();
    }).timeout(10000);
  });

  describe('when jobs consumed with job options', () => {
    it('options should be set on jobs', async () => {
      const streamName = `test-${v4()}`;
      const producer = new Producer(streamName, {
        connection: generalConnection,
      });
      const fanout = new FanoutWorker(streamName, {
        connection: consumerConnection,
      });
      const queue = new Queue(`test-${v4()}`, {
        connection: generalConnection,
      });
      const jobs = 10;

      fanout
        .fanout([queue], (data: any) => ({ jobId: `test-${data.idx}` }))
        .then();

      for (let i = 1; i <= jobs; i++) {
        await producer.produce({ idx: i });
      }

      while ((await queue.count()) < jobs) {
        await delay(50);
      }

      expect(await queue.count()).to.be.eql(jobs);
      expect((await queue.getWaiting()).map(job => job.opts)).to.be.eql(
        Array.from(Array(jobs).keys()).map(i => ({
          jobId: `test-${i + 1}`,
          attempts: 0,
          backoff: undefined,
        })),
      );
      await fanout.close();
    }).timeout(10000);
  });

  describe('when jobs produced with a late fanout', () => {
    it('should fanout to defined queues', async () => {
      const streamName = `test-${v4()}`;
      const producer = new Producer(streamName, {
        connection: generalConnection,
      });
      const fanout = new FanoutWorker(streamName, {
        connection: consumerConnection,
      });
      const queues = [
        new Queue(`test-${v4()}`, { connection: generalConnection }),
        new Queue(`test-${v4()}`, { connection: generalConnection }),
      ];
      const jobs = 10;

      for (let i = 1; i <= jobs / 2; i++) {
        await producer.produce({ idx: i });
      }

      fanout.fanout(queues).then().catch(console.error);

      for (let i = jobs / 2 + 1; i <= jobs; i++) {
        await producer.produce({ idx: i });
      }

      while ((await queues[1].count()) < jobs) {
        await delay(50);
      }
      for (const queue of queues) {
        expect(await queue.count()).to.be.eql(jobs);
        expect((await queue.getWaiting()).map(job => job.data.idx)).to.be.eql(
          Array.from(Array(jobs).keys()).map(i => i + 1),
        );
      }
      await fanout.close();
    }).timeout(10000);
  });

  describe('when fanout is stopped and restarted', () => {
    it('should not consume acked messages', async () => {
      const streamName = `test-${v4()}`;
      const producer = new Producer(streamName, {
        connection: generalConnection,
      });
      const fanout = new FanoutWorker(streamName, {
        connection: consumerConnection,
      });
      const queues = [
        new Queue(`test-${v4()}`, { connection: generalConnection }),
        new Queue(`test-${v4()}`, { connection: generalConnection }),
      ];
      const laterFanout = new FanoutWorker(streamName, {
        connection: consumerConnection,
      });
      const jobs = 10;

      fanout.fanout(queues).then().catch(console.error);

      for (let i = 1; i <= jobs; i++) {
        await producer.produce({ idx: i });
      }

      while ((await queues[1].count()) < jobs) {
        await delay(50);
      }
      await fanout.close();

      laterFanout.fanout(queues).then().catch(console.error);

      for (const queue of queues) {
        await queue.clean(0, 1000, 'wait');
      }

      for (let i = 1; i <= jobs; i++) {
        await producer.produce({ idx: i + 20 });
      }

      while ((await queues[1].count()) < jobs) {
        await delay(50);
      }

      for (const queue of queues) {
        expect(await queue.count()).to.be.eql(jobs);
        expect((await queue.getWaiting()).map(job => job.data.idx)).to.be.eql(
          Array.from(Array(jobs).keys()).map(i => i + 1 + 20),
        );
      }
      await laterFanout.close();
    }).timeout(10000);
  });
});
