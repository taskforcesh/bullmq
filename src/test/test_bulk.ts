import { Queue, Worker, Job } from '../classes';
import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { removeAllQueueData } from '../utils';
import { reject } from 'lodash';

describe('bulk jobs', () => {
  let queue: Queue;
  let queueName: string;

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
  });

  afterEach(async function() {
    await queue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should process jobs', async () => {
    const name = 'test';
    let processor;
    const processing = new Promise<void>(resolve => [
      (processor = async (job: Job) => {
        if (job.data.idx === 0) {
          expect(job.data.foo).to.be.equal('bar');
        } else {
          expect(job.data.idx).to.be.equal(1);
          expect(job.data.foo).to.be.equal('baz');
          resolve();
        }
      }),
    ]);
    const worker = new Worker(queueName, processor);
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

  it('should process children before the parent', async () => {
    const name = 'child-job';
    const values = [
      { bar: 'something' },
      { baz: 'something' },
      { qux: 'something' },
    ];

    const parentQueue = 'parent-queue';

    let childrenProcessor,
      parentProcessor,
      processedChildren = 0;
    const processingChildren = new Promise<void>(resolve => [
      (childrenProcessor = async (job: Job) => {
        processedChildren++;

        if (processedChildren == values.length) {
          resolve();
        }
        return values[job.data.idx];
      }),
    ]);

    const processingParent = new Promise<void>(resolve => [
      (parentProcessor = async (job: Job) => {
        expect(processedChildren).to.be.equal(3);

        const childrenValues = await job.getChildrenValues();

        try {
          for (let i = 0; i < values.length; i++) {
            const jobKey = queue.toKey(jobs[i].id);
            expect(childrenValues[jobKey]).to.be.deep.equal(values[i]);
          }
          resolve();
        } catch (err) {
          console.error(err);
          reject(err);
        }
      }),
    ]);

    const parentWorker = new Worker(parentQueue, parentProcessor);
    const childrenWorker = new Worker(queueName, childrenProcessor);

    const jobs = await queue.addBulk(
      [
        { name, data: { idx: 0, foo: 'bar' } },
        { name, data: { idx: 1, foo: 'baz' } },
        { name, data: { idx: 2, foo: 'qux' } },
      ],
      {
        parent: {
          name: 'parent-job',
          queue: parentQueue,
        },
      },
    );
    expect(jobs).to.have.length(3);

    expect(jobs[0].id).to.be.ok;
    expect(jobs[0].data.foo).to.be.eql('bar');
    expect(jobs[1].id).to.be.ok;
    expect(jobs[1].data.foo).to.be.eql('baz');
    expect(jobs[2].id).to.be.ok;
    expect(jobs[2].data.foo).to.be.eql('qux');

    await processingChildren;
    await childrenWorker.close();

    await processingParent;
    await parentWorker.close();
  });

  it('should not process parent if child fails', async () => {
    const name = 'child-job';

    const parentQueueName = 'parent-queue';

    let childrenProcessor;
    const processingChildren = new Promise<void>(resolve => [
      (childrenProcessor = async (job: Job) => {
        resolve();
        throw new Error('failed job');
      }),
    ]);

    const childrenWorker = new Worker(queueName, childrenProcessor);

    const jobs = await queue.addBulk([{ name, data: { idx: 0, foo: 'bar' } }], {
      parent: {
        name: 'parent-job',
        queue: parentQueueName,
      },
    });
    expect(jobs).to.have.length(1);

    expect(jobs[0].id).to.be.ok;
    expect(jobs[0].data.foo).to.be.eql('bar');

    await processingChildren;
    await childrenWorker.close();

    const parentQueue = new Queue(parentQueueName);
    const numJobs = await parentQueue.getWaitingCount();
    expect(numJobs).to.be.equal(0);
  });
});
