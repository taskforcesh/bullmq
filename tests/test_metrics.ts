import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { beforeEach, describe, it } from 'mocha';
import * as sinon from 'sinon';
import { v4 } from 'uuid';
import { MetricsTime, Queue, QueueEvents, Repeat, Worker } from '../src';
import { removeAllQueueData } from '../src/utils';

const ONE_SECOND = 1000;
const ONE_MINUTE = 60 * ONE_SECOND;
const ONE_HOUR = 60 * ONE_MINUTE;

describe('metrics', function () {
  this.timeout(10000);
  let repeat: Repeat;
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  const connection = { host: 'localhost' };

  beforeEach(function () {
    this.clock = sinon.useFakeTimers();
  });

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection });
    repeat = new Repeat(queueName, { connection });
    queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();
  });

  afterEach(async function () {
    this.clock.restore();
    await queue.close();
    await repeat.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should gather metrics for completed jobs', async function () {
    const date = new Date('2017-02-07 9:24:00');
    this.clock.setSystemTime(date);
    this.clock.tick(0);

    const timmings = [
      0,
      0, // For the fixtures to work we need to use 0 as first timing
      ONE_MINUTE / 2,
      ONE_MINUTE / 2,
      0,
      0,
      ONE_MINUTE,
      ONE_MINUTE,
      ONE_MINUTE * 3,
      ONE_HOUR,
      ONE_MINUTE,
    ];

    const fixture = [
      '1',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '1',
      '0',
      '0',
      '1',
      '1',
      '3',
      '3',
    ];

    const numJobs = timmings.length;

    const worker = new Worker(
      queueName,
      async job => {
        this.clock.tick(timmings[job.data.index]);
      },
      {
        connection,
        metrics: {
          maxDataPoints: MetricsTime.ONE_HOUR * 2,
        },
      },
    );

    await worker.waitUntilReady();

    let processed = 0;
    const completing = new Promise<void>(resolve => {
      worker.on('completed', async () => {
        processed++;
        if (processed === numJobs) {
          resolve();
        }
      });
    });

    for (let i = 0; i < numJobs; i++) {
      await queue.add('test', { index: i });
    }

    await completing;

    const closing = worker.close();

    await closing;

    const metrics = await queue.getMetrics('completed');

    const numPoints = Math.floor(
      timmings.reduce((sum, timing) => sum + timing, 0) / ONE_MINUTE,
    );

    expect(metrics.meta.count).to.be.equal(numJobs);
    expect(metrics.data.length).to.be.equal(numPoints);
    expect(metrics.count).to.be.equal(metrics.data.length);
    expect(processed).to.be.equal(numJobs);
    expect(metrics.data).to.be.deep.equal(fixture);
  });

  it('should only keep metrics for "maxDataPoints"', async function () {
    const date = new Date('2017-02-07 9:24:00');
    this.clock.setSystemTime(date);
    this.clock.tick(0);

    const timmings = [
      0, // For the fixtures to work we need to use 0 as first timing
      0,
      ONE_MINUTE / 2,
      ONE_MINUTE / 2,
      0,
      0,
      ONE_MINUTE,
      ONE_MINUTE,
      ONE_MINUTE * 3,
      ONE_HOUR,
      0,
      0,
      ONE_MINUTE,
      ONE_MINUTE,
    ];

    const fixture = [
      '1',
      '3',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
    ];

    const numJobs = timmings.length;

    const worker = new Worker(
      queueName,
      async job => {
        this.clock.tick(timmings[job.data.index]);
      },
      {
        connection,
        metrics: {
          maxDataPoints: MetricsTime.FIFTEEN_MINUTES,
        },
      },
    );

    await worker.waitUntilReady();

    let processed = 0;
    const completing = new Promise<void>(resolve => {
      worker.on('completed', async () => {
        processed++;
        if (processed === numJobs) {
          resolve();
        }
      });
    });

    for (let i = 0; i < numJobs; i++) {
      await queue.add('test', { index: i });
    }

    await completing;

    const closing = worker.close();

    await closing;

    const metrics = await queue.getMetrics('completed');

    expect(metrics.meta.count).to.be.equal(numJobs);
    expect(metrics.data.length).to.be.equal(MetricsTime.FIFTEEN_MINUTES);
    expect(metrics.count).to.be.equal(metrics.data.length);
    expect(processed).to.be.equal(numJobs);
    expect(metrics.data).to.be.deep.equal(fixture);
  });

  it('should gather metrics for failed jobs', async function () {
    const date = new Date('2017-02-07 9:24:00');
    this.clock.setSystemTime(date);
    this.clock.tick(0);

    const timmings = [
      0, // For the fixtures to work we need to use 0 as first timing
      ONE_MINUTE,
      ONE_MINUTE / 5,
      ONE_MINUTE / 2,
      0,
      ONE_MINUTE,
      ONE_MINUTE * 3,
      0,
    ];

    const fixture = ['0', '0', '1', '4', '1'];

    const numJobs = timmings.length;

    const worker = new Worker(
      queueName,
      async job => {
        this.clock.tick(timmings[job.data.index]);
        throw new Error('test');
      },
      {
        connection,
        metrics: {
          maxDataPoints: MetricsTime.ONE_HOUR * 2,
        },
      },
    );

    await worker.waitUntilReady();

    let processed = 0;
    const completing = new Promise<void>(resolve => {
      worker.on('failed', async () => {
        processed++;
        if (processed === numJobs) {
          resolve();
        }
      });
    });

    for (let i = 0; i < numJobs; i++) {
      await queue.add('test', { index: i });
    }

    await completing;

    const closing = worker.close();

    await closing;

    const metrics = await queue.getMetrics('failed');

    const numPoints = Math.floor(
      timmings.reduce((sum, timing) => sum + timing, 0) / ONE_MINUTE,
    );

    expect(metrics.meta.count).to.be.equal(numJobs);
    expect(metrics.data.length).to.be.equal(numPoints);
    expect(metrics.count).to.be.equal(metrics.data.length);
    expect(processed).to.be.equal(numJobs);
    expect(metrics.data).to.be.deep.equal(fixture);
  });

  it('should get metrics with pagination', async function () {
    const date = new Date('2017-02-07 9:24:00');
    this.clock.setSystemTime(date);
    this.clock.tick(0);

    const timmings = [
      0,
      0, // For the fixtures to work we need to use 0 as first timing
      ONE_MINUTE / 2,
      ONE_MINUTE / 2,
      0,
      0,
      ONE_MINUTE,
      ONE_MINUTE,
      ONE_MINUTE * 3,
      ONE_HOUR,
      ONE_MINUTE,
    ];

    const numJobs = timmings.length;

    const worker = new Worker(
      queueName,
      async job => {
        this.clock.tick(timmings[job.data.index]);
      },
      {
        connection,
        metrics: {
          maxDataPoints: MetricsTime.ONE_HOUR * 2,
        },
      },
    );

    await worker.waitUntilReady();

    let processed = 0;
    const completing = new Promise<void>(resolve => {
      worker.on('completed', async () => {
        processed++;
        if (processed === numJobs) {
          resolve();
        }
      });
    });

    for (let i = 0; i < numJobs; i++) {
      await queue.add('test', { index: i });
    }

    await completing;

    const closing = worker.close();

    await closing;

    expect(processed).to.be.equal(numJobs);

    const numPoints = Math.floor(
      timmings.reduce((sum, timing) => sum + timing, 0) / ONE_MINUTE,
    );

    const pageSize = 10;
    const data = [];
    let skip = 0;

    while (skip < numPoints) {
      const metrics = await queue.getMetrics(
        'completed',
        skip,
        skip + pageSize - 1,
      );
      expect(metrics.meta.count).to.be.equal(numJobs);
      expect(metrics.data.length).to.be.equal(
        Math.min(numPoints - skip, pageSize),
      );

      data.push(...metrics.data);
      skip += pageSize;
    }

    const metrics = await queue.getMetrics('completed');
    expect(data).to.be.deep.equal(metrics.data);
  });
});
