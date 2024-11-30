import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { after as afterNumExecutions } from 'lodash';
import { after, beforeEach, describe, it, before } from 'mocha';
import { v4 } from 'uuid';
import { Queue, QueueEvents, Worker, Job } from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

describe('bulk jobs', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;

  let connection;
  before(async function () {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
  });

  afterEach(async function () {
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  after(async function () {
    await connection.quit();
  });

  it('should process jobs', async () => {
    const name = 'test';
    let processor;
    const processing = new Promise<void>(
      resolve =>
        (processor = async (job: Job) => {
          if (job.data.idx === 0) {
            expect(job.data.foo).to.be.equal('bar');
          } else {
            expect(job.data.idx).to.be.equal(1);
            expect(job.data.foo).to.be.equal('baz');
            resolve();
          }
        }),
    );
    const worker = new Worker(queueName, processor, { connection, prefix });
    await worker.waitUntilReady();

    const jobs = await queue.addBulk([
      { name, data: { idx: 0, foo: 'bar' } },
      { name, data: { idx: 1, foo: 'baz' } },
    ]);
    expect(jobs).to.have.length(2);

    expect(jobs[0].id).to.be.ok;
    expect(jobs[0].data.foo).to.be.eql('bar');
    expect(jobs[1].id).to.be.ok;
    expect(jobs[1].data.foo).to.be.eql('baz');

    await processing;
    await worker.close();
  });

  it('should allow to pass parent option', async () => {
    const name = 'test';
    const parentQueueName = `parent-queue-${v4()}`;
    const parentQueue = new Queue(parentQueueName, { connection, prefix });

    const parentWorker = new Worker(parentQueueName, null, {
      connection,
      prefix,
    });
    const childrenWorker = new Worker(queueName, null, { connection, prefix });
    await parentWorker.waitUntilReady();
    await childrenWorker.waitUntilReady();

    const parent = await parentQueue.add('parent', { some: 'data' });
    const jobs = await queue.addBulk([
      {
        name,
        data: { idx: 0, foo: 'bar' },
        opts: {
          parent: {
            id: parent.id,
            queue: `${prefix}:${parentQueueName}`,
          },
        },
      },
      {
        name,
        data: { idx: 1, foo: 'baz' },
        opts: {
          parent: {
            id: parent.id,
            queue: `${prefix}:${parentQueueName}`,
          },
        },
      },
    ]);
    expect(jobs).to.have.length(2);

    expect(jobs[0].id).to.be.ok;
    expect(jobs[0].data.foo).to.be.eql('bar');
    expect(jobs[1].id).to.be.ok;
    expect(jobs[1].data.foo).to.be.eql('baz');

    const { unprocessed } = await parent.getDependenciesCount({
      unprocessed: true,
    });

    expect(unprocessed).to.be.equal(2);

    await childrenWorker.close();
    await parentWorker.close();
    await parentQueue.close();
    await removeAllQueueData(new IORedis(redisHost), parentQueueName);
  });

  it('should keep workers busy', async () => {
    const numJobs = 6;
    const queue2 = new Queue(queueName, { connection, markerCount: 2, prefix });

    const queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();

    const worker = new Worker(
      queueName,
      async () => {
        await delay(1000);
      },
      { connection, prefix },
    );
    const worker2 = new Worker(
      queueName,
      async () => {
        await delay(1000);
      },
      { connection, prefix },
    );
    await worker.waitUntilReady();
    await worker2.waitUntilReady();

    const completed = new Promise(resolve => {
      queueEvents.on('completed', afterNumExecutions(numJobs, resolve));
    });

    const jobs = Array.from(Array(numJobs).keys()).map(index => ({
      name: 'test',
      data: { index },
    }));

    await queue2.addBulk(jobs);

    await completed;
    await queue2.close();
    await worker.close();
    await worker2.close();
    await queueEvents.close();
  });

  it('should process jobs with custom ids', async () => {
    const name = 'test';
    let processor;
    const processing = new Promise<void>(
      resolve =>
        (processor = async (job: Job) => {
          if (job.data.idx === 0) {
            expect(job.data.foo).to.be.equal('bar');
          } else {
            expect(job.data.idx).to.be.equal(1);
            expect(job.data.foo).to.be.equal('baz');
            resolve();
          }
        }),
    );
    const worker = new Worker(queueName, processor, { connection, prefix });
    await worker.waitUntilReady();

    const jobs = await queue.addBulk([
      { name, data: { idx: 0, foo: 'bar' }, opts: { jobId: 'test1' } },
      { name, data: { idx: 1, foo: 'baz' }, opts: { jobId: 'test2' } },
    ]);
    expect(jobs).to.have.length(2);

    expect(jobs[0].id).to.be.eql('test1');
    expect(jobs[0].data.foo).to.be.eql('bar');
    expect(jobs[1].id).to.be.eql('test2');
    expect(jobs[1].data.foo).to.be.eql('baz');

    await processing;
    await worker.close();
  });
});
