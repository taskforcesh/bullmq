import { Queue, Worker, Job, Flow } from '../classes';
import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import { removeAllQueueData, delay } from '../utils';

describe('flows', () => {
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

  it('should process children before the parent', async () => {
    const name = 'child-job';
    const values = [
      { bar: 'something' },
      { baz: 'something' },
      { qux: 'something' },
    ];

    const parentQueueName = 'parent-queue';

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

    const processingParent = new Promise<void>((resolve, reject) => [
      (parentProcessor = async (job: Job) => {
        try {
          expect(processedChildren).to.be.equal(3);

          const childrenValues = await job.getChildrenValues();

          for (let i = 0; i < values.length; i++) {
            const jobKey = queue.toKey(tree.children[i].job.id);
            expect(childrenValues[jobKey]).to.be.deep.equal(values[i]);
          }
          resolve();
        } catch (err) {
          console.error(err);
          reject(err);
        }
      }),
    ]);

    const parentWorker = new Worker(parentQueueName, parentProcessor);
    const childrenWorker = new Worker(queueName, childrenProcessor);

    const flow = new Flow();
    const tree = await flow.add({
      name: 'parent-job',
      queueName: parentQueueName,
      data: {},
      children: [
        { name, data: { idx: 0, foo: 'bar' }, queueName },
        { name, data: { idx: 1, foo: 'baz' }, queueName },
        { name, data: { idx: 2, foo: 'qux' }, queueName },
      ],
    });

    expect(tree).to.have.property('job');
    expect(tree).to.have.property('children');

    const { children, job } = tree;
    const parentState = await job.getState();

    expect(parentState).to.be.eql('waiting-children');
    expect(children).to.have.length(3);

    expect(children[0].job.id).to.be.ok;
    expect(children[0].job.data.foo).to.be.eql('bar');
    expect(children[1].job.id).to.be.ok;
    expect(children[1].job.data.foo).to.be.eql('baz');
    expect(children[2].job.id).to.be.ok;
    expect(children[2].job.data.foo).to.be.eql('qux');

    await processingChildren;
    await childrenWorker.close();

    await processingParent;
    await parentWorker.close();

    await flow.close();

    await removeAllQueueData(new IORedis(), parentQueueName);
  });

  it('should process a chain of jobs', async () => {
    const name = 'child-job';
    const values = [
      { idx: 0, bar: 'something' },
      { idx: 1, baz: 'something' },
      { idx: 2, qux: 'something' },
    ];

    const topQueueName = 'top-queue';

    let childrenProcessor,
      parentProcessor,
      processedChildren = 0;
    const processingChildren = new Promise<void>((resolve, reject) => [
      (childrenProcessor = async (job: Job) => {
        try {
          const childrenValues = await job.getChildrenValues();

          expect(job.data.idx).to.be.eql(values.length - 1 - processedChildren);
          switch (job.data.idx) {
            case 0:
              {
                const jobKey = queue.toKey(tree.children[0].children[0].job.id);
                expect(childrenValues[jobKey]).to.be.deep.equal(values[1]);
              }
              break;
            case 1:
              {
                const jobKey = queue.toKey(
                  tree.children[0].children[0].children[0].job.id,
                );
                expect(childrenValues[jobKey]).to.be.deep.equal(values[2]);
              }
              break;
          }

          processedChildren++;
          if (processedChildren == values.length) {
            resolve();
          }
          return values[job.data.idx];
        } catch (err) {
          reject(err);
        }
      }),
    ]);

    const processingTop = new Promise<void>((resolve, reject) => [
      (parentProcessor = async (job: Job) => {
        try {
          expect(processedChildren).to.be.equal(3);

          const childrenValues = await job.getChildrenValues();

          const jobKey = queue.toKey(tree.children[0].job.id);
          expect(childrenValues[jobKey]).to.be.deep.equal(values[0]);

          resolve();
        } catch (err) {
          console.error(err);
          reject(err);
        }
      }),
    ]);

    const parentWorker = new Worker(topQueueName, parentProcessor);
    const childrenWorker = new Worker(queueName, childrenProcessor);

    const flow = new Flow();
    const tree = await flow.add({
      name: 'root-job',
      queueName: topQueueName,
      data: {},
      children: [
        {
          name,
          data: { idx: 0, foo: 'bar' },
          queueName,
          children: [
            {
              name,
              data: { idx: 1, foo: 'baz' },
              queueName,
              children: [{ name, data: { idx: 2, foo: 'qux' }, queueName }],
            },
          ],
        },
      ],
    });

    expect(tree).to.have.property('job');
    expect(tree).to.have.property('children');

    const { children, job } = tree;
    const isWaitingChildren = await job.isWaitingChildren();

    expect(isWaitingChildren).to.be.true;
    expect(children).to.have.length(1);

    expect(children[0].job.id).to.be.ok;
    expect(children[0].job.data.foo).to.be.eql('bar');
    expect(children[0].children).to.have.length(1);

    expect(children[0].children[0].job.id).to.be.ok;
    expect(children[0].children[0].job.data.foo).to.be.eql('baz');

    expect(children[0].children[0].children[0].job.id).to.be.ok;
    expect(children[0].children[0].children[0].job.data.foo).to.be.eql('qux');

    await processingChildren;
    await childrenWorker.close();

    await processingTop;
    await parentWorker.close();

    await flow.close();

    await removeAllQueueData(new IORedis(), topQueueName);
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

    const flow = new Flow();
    const tree = await flow.add({
      name: 'parent-job',
      queueName: parentQueueName,
      data: {},
      children: [{ name, data: { idx: 0, foo: 'bar' }, queueName }],
    });

    expect(tree).to.have.property('job');
    expect(tree).to.have.property('children');

    const { children } = tree;

    expect(children).to.have.length(1);

    expect(children[0].job.id).to.be.ok;
    expect(children[0].job.data.foo).to.be.eql('bar');

    await processingChildren;
    await childrenWorker.close();

    const parentQueue = new Queue(parentQueueName);
    const numJobs = await parentQueue.getWaitingCount();
    expect(numJobs).to.be.equal(0);

    await removeAllQueueData(new IORedis(), parentQueueName);
  });

  it('should not process parent until queue is unpaused', async () => {
    const name = 'child-job';
    const parentQueueName = 'parent-queue';

    let childrenProcessor, parentProcessor;
    const processingChildren = new Promise<void>(resolve => [
      (childrenProcessor = async (job: Job) => {
        resolve();
      }),
    ]);

    const childrenWorker = new Worker(queueName, childrenProcessor);

    const processingParent = new Promise<void>(resolve => [
      (parentProcessor = async (job: Job) => {
        resolve();
      }),
    ]);

    const parentWorker = new Worker(parentQueueName, parentProcessor);

    const parentQueue = new Queue(parentQueueName);
    await parentQueue.pause();

    const flow = new Flow();
    const tree = await flow.add({
      name: 'parent-job',
      queueName: parentQueueName,
      data: {},
      children: [{ name, data: { idx: 0, foo: 'bar' }, queueName }],
    });

    expect(tree).to.have.property('job');
    expect(tree).to.have.property('children');

    const { children } = tree;

    expect(children).to.have.length(1);

    expect(children[0].job.id).to.be.ok;
    expect(children[0].job.data.foo).to.be.eql('bar');

    await processingChildren;
    await childrenWorker.close();

    await delay(500);

    let numJobs = await parentQueue.getWaitingCount();
    expect(numJobs).to.be.equal(1);

    await parentQueue.resume();

    await processingParent;
    await parentWorker.close();

    numJobs = await parentQueue.getWaitingCount();
    expect(numJobs).to.be.equal(0);

    await removeAllQueueData(new IORedis(), parentQueueName);
  });
});
