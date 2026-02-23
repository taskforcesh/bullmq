import { default as IORedis } from 'ioredis';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { v4 } from 'uuid';
import {
  Job,
  Queue,
  QueueEvents,
  Worker,
  FlowProducer,
  JobNode,
  WaitingChildrenError,
  DelayedError,
  RateLimitError,
} from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

describe('flows', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  let queue: Queue;
  let queueName: string;

  let connection: IORedis;
  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection, prefix });
  });

  afterEach(async () => {
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async function () {
    await connection.quit();
  });

  describe('when removeOnFail is true in last pending child', () => {
    it('moves parent to wait without getting stuck', async () => {
      const worker = new Worker(
        queueName,
        async job => {
          if (job.name === 'child0') {
            throw new Error('fail');
          }
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const flow = new FlowProducer({ connection, prefix });
      await flow.add({
        name: 'parent',
        data: {},
        queueName,
        children: [
          {
            queueName,
            name: 'child0',
            data: {},
            opts: {
              removeOnFail: true,
            },
          },
          {
            queueName,
            name: 'child1',
            data: {},
          },
        ],
      });

      const completed = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job) => {
          try {
            if (job.name === 'parent') {
              const { processed } = await job.getDependenciesCount();
              expect(processed).toBe(1);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      await completed;
      await flow.close();
      await worker.close();
    });
  });

  describe('when removeOnComplete is true in children', () => {
    it('keeps children results in parent', async () => {
      const worker = new Worker(
        queueName,
        async job => {
          return job.name;
        },
        { connection, prefix },
      );
      await worker.waitUntilReady();

      const flow = new FlowProducer({ connection, prefix });
      const { children } = await flow.add({
        name: 'parent',
        data: {},
        queueName,
        children: [
          {
            queueName,
            name: 'child0',
            data: {},
            opts: {
              removeOnComplete: true,
            },
          },
          {
            queueName,
            name: 'child1',
            data: {},
            opts: {
              removeOnComplete: true,
            },
          },
        ],
      });

      const completed = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job) => {
          try {
            if (job.name === 'parent') {
              const { processed } = await job.getDependencies();
              expect(Object.keys(processed!).length).toBe(2);
              const { queueQualifiedName, id, name } = children![0].job;
              expect(processed![`${queueQualifiedName}:${id}`]).toBe(name);
              const {
                queueQualifiedName: queueQualifiedName2,
                id: id2,
                name: name2,
              } = children![1].job;
              expect(processed![`${queueQualifiedName2}:${id2}`]).toBe(name2);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      await completed;
      await flow.close();
      await worker.close();
    });
  });

  describe('when removeOnComplete contains age in children and time is reached', () => {
    it('keeps children results in parent', async () => {
      const worker = new Worker(
        queueName,
        async job => {
          await delay(1000);
          return job.name;
        },
        { connection, prefix, removeOnComplete: { age: 1 } },
      );
      await worker.waitUntilReady();

      const flow = new FlowProducer({ connection, prefix });
      const { children } = await flow.add(
        {
          name: 'parent',
          data: {},
          queueName,
          children: [
            {
              queueName,
              name: 'child0',
              data: {},
              opts: {
                removeOnComplete: {
                  age: 1,
                },
              },
            },
            {
              queueName,
              name: 'child1',
              data: {},
              opts: {
                removeOnComplete: {
                  age: 1,
                },
              },
            },
          ],
          opts: {
            removeOnComplete: {
              age: 1,
            },
          },
        },
        {
          queuesOptions: {
            [queueName]: {
              defaultJobOptions: {
                removeOnComplete: {
                  age: 1,
                },
              },
            },
          },
        },
      );

      const completed = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job) => {
          try {
            if (job.name === 'parent') {
              const { processed } = await job.getDependencies();
              expect(Object.keys(processed!).length).toBe(2);
              const { queueQualifiedName, id, name } = children![0].job;
              expect(processed![`${queueQualifiedName}:${id}`]).toBe(name);
              const {
                queueQualifiedName: queueQualifiedName2,
                id: id2,
                name: name2,
              } = children![1].job;
              expect(processed![`${queueQualifiedName2}:${id2}`]).toBe(name2);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      await completed;
      const remainingJobCount = await queue.getCompletedCount();

      expect(remainingJobCount).toBe(1);
      await worker.close();
      await flow.close();
    }); // TODO: Add { timeout: 8000 } to the it() options
  });

  it('should process children before the parent', async () => {
    const name = 'child-job';
    const values = [
      { bar: 'something' },
      { baz: 'something' },
      { qux: 'something' },
    ];

    const parentQueueName = `parent-queue-${v4()}`;

    let childrenProcessor,
      parentProcessor,
      processedChildren = 0;
    const processingChildren = new Promise<void>(
      resolve =>
        (childrenProcessor = async (job: Job) => {
          processedChildren++;

          if (processedChildren == values.length) {
            resolve();
          }
          return values[job.data.idx];
        }),
    );

    const processingParent = new Promise<void>((resolve, reject) => [
      (parentProcessor = async (job: Job) => {
        try {
          const { processed, nextProcessedCursor } = await job.getDependencies({
            processed: {},
          });
          expect(nextProcessedCursor).toBe(0);
          expect(Object.keys(processed!)).toHaveLength(3);

          const childrenValues = await job.getChildrenValues();

          for (let i = 0; i < values.length; i++) {
            const jobKey = queue.toKey(tree.children![i].job.id!);
            expect(childrenValues[jobKey]).to.be.deep.equal(values[i]);
          }
          resolve();
        } catch (err) {
          console.error(err);
          reject(err);
        }
      }),
    ]);

    const parentWorker = new Worker(parentQueueName, parentProcessor, {
      connection,
      prefix,
    });
    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
      prefix,
    });
    await parentWorker.waitUntilReady();
    await childrenWorker.waitUntilReady();

    const flow = new FlowProducer({ connection, prefix });
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

    expect(tree).toHaveProperty('job');
    expect(tree).toHaveProperty('children');

    const { children, job } = tree;
    const parentState = await job.getState();

    expect(parentState).toEqual('waiting-children');
    expect(children).toHaveLength(3);

    expect(children![0].job.id).toBeTruthy();
    expect(children![0].job.data.foo).toEqual('bar');
    expect(children![0].job.parent).toEqual({
      id: job.id,
      queueKey: `${prefix}:${parentQueueName}`,
    });
    expect(children![1].job.id).toBeTruthy();
    expect(children![1].job.data.foo).toEqual('baz');
    expect(children![2].job.id).toBeTruthy();
    expect(children![2].job.data.foo).toEqual('qux');

    await processingChildren;
    await childrenWorker.close();

    await processingParent;
    await parentWorker.close();

    await flow.close();

    await removeAllQueueData(new IORedis(redisHost), parentQueueName);
  });

  it('should allow parent opts on the root job', async () => {
    const name = 'child-job';
    const values = [{ bar: 'something' }, { baz: 'something' }];

    const parentQueueName = `parent-queue-${v4()}`;
    const grandparentQueueName = `grandparent-queue-${v4()}`;
    const grandparentQueue = new Queue(grandparentQueueName, {
      connection,
      prefix,
    });
    const grandparentJob = await grandparentQueue.add('grandparent', {
      foo: 'bar',
    });

    let childrenProcessor,
      parentProcessor,
      processedChildren = 0;
    const processingChildren = new Promise<void>(
      resolve =>
        (childrenProcessor = async (job: Job) => {
          processedChildren++;

          if (processedChildren == values.length) {
            resolve();
          }
          return values[job.data.idx];
        }),
    );

    const processingParent = new Promise<void>((resolve, reject) => [
      (parentProcessor = async (job: Job) => {
        try {
          const { processed, nextProcessedCursor } = await job.getDependencies({
            processed: {},
          });
          expect(nextProcessedCursor).toBe(0);
          expect(Object.keys(processed!)).toHaveLength(2);

          const childrenValues = await job.getChildrenValues();

          for (let i = 0; i < values.length; i++) {
            const jobKey = queue.toKey(tree.children![i].job.id!);
            expect(childrenValues[jobKey]).to.be.deep.equal(values[i]);
          }
          resolve();
        } catch (err) {
          console.error(err);
          reject(err);
        }
      }),
    ]);

    const parentWorker = new Worker(parentQueueName, parentProcessor, {
      connection,
      prefix,
    });
    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
      prefix,
    });
    await parentWorker.waitUntilReady();
    await childrenWorker.waitUntilReady();

    const flow = new FlowProducer({ connection, prefix });
    const tree = await flow.add({
      name: 'parent-job',
      queueName: parentQueueName,
      data: {},
      children: [
        { name, data: { idx: 0, foo: 'bar' }, queueName },
        { name, data: { idx: 1, foo: 'baz' }, queueName },
      ],
      opts: {
        parent: {
          id: grandparentJob.id!,
          queue: `${prefix}:${grandparentQueueName}`,
        },
      },
    });

    expect(tree).toHaveProperty('job');
    expect(tree).toHaveProperty('children');

    const { children, job } = tree;

    expect(job.parentKey).toBe(
      `${prefix}:${grandparentQueueName}:${grandparentJob.id}`,
    );
    const parentState = await job.getState();

    expect(parentState).toEqual('waiting-children');
    expect(children).toHaveLength(2);

    await processingChildren;
    await childrenWorker.close();

    await processingParent;
    await parentWorker.close();

    await flow.close();

    await grandparentQueue.close();
    await removeAllQueueData(new IORedis(redisHost), grandparentQueueName);
    await removeAllQueueData(new IORedis(redisHost), parentQueueName);
  });

  describe('when removeChildDependency is called', () => {
    describe('when last child call this method', () => {
      it('moves parent to wait', async () => {
        const flow = new FlowProducer({ connection, prefix });
        const { job, children } = await flow.add({
          name: 'parent',
          data: {},
          queueName,
          children: [
            {
              queueName,
              name: 'child0',
              data: {},
              opts: {},
            },
          ],
        });

        const relationshipIsBroken =
          await children![0].job.removeChildDependency();

        expect(relationshipIsBroken).toBe(true);
        expect(children![0].job.parent).toBeUndefined();
        expect(children![0].job.parentKey).toBeUndefined();

        const parentState = await job.getState();

        expect(parentState).toBe('waiting');

        const worker = new Worker(
          queueName,
          async () => {
            await delay(100);
          },
          { connection, prefix },
        );
        await worker.waitUntilReady();

        const completed = new Promise<void>((resolve, reject) => {
          worker.on('completed', async (job: Job) => {
            try {
              if (job.name === 'parent') {
                const { unprocessed, processed, ignored, failed } =
                  await job.getDependenciesCount();
                expect(ignored).toBe(0);
                expect(failed).toBe(0);
                expect(unprocessed).toBe(0);
                expect(processed).toBe(0);
                resolve();
              }
            } catch (err) {
              reject(err);
            }
          });
        });

        await completed;

        await flow.close();
        await worker.close();
      });
    });

    describe('when there are pending children when calling this method', () => {
      it('keeps parent in waiting-children state', async () => {
        const flow = new FlowProducer({ connection, prefix });
        const { job, children } = await flow.add({
          name: 'parent',
          data: {},
          queueName,
          children: [
            {
              queueName,
              name: 'child0',
              data: {},
              opts: {},
            },
            {
              queueName,
              name: 'child1',
              data: {},
              opts: {},
            },
          ],
        });

        const relationshipIsBroken =
          await children![0].job.removeChildDependency();

        expect(relationshipIsBroken).toBe(true);
        expect(children![0].job.parent).toBeUndefined();
        expect(children![0].job.parentKey).toBeUndefined();

        const parentState = await job.getState();

        expect(parentState).toBe('waiting-children');

        const worker = new Worker(
          queueName,
          async () => {
            await delay(100);
          },
          { connection, prefix },
        );
        await worker.waitUntilReady();

        const completed = new Promise<void>((resolve, reject) => {
          worker.on('completed', async (job: Job) => {
            try {
              if (job.name === 'parent') {
                const { unprocessed, processed } =
                  await job.getDependenciesCount();
                expect(unprocessed).toBe(0);
                expect(processed).toBe(1);
                resolve();
              }
            } catch (err) {
              reject(err);
            }
          });
        });

        await completed;

        await flow.close();
        await worker.close();
      });
    });

    describe('when parent does not exist', () => {
      it('throws an error', async () => {
        const flow = new FlowProducer({ connection, prefix });
        const { job, children } = await flow.add({
          name: 'parent',
          data: {},
          queueName,
          children: [
            {
              queueName,
              name: 'child0',
              data: {},
              opts: {},
            },
            {
              queueName,
              name: 'child1',
              data: {},
              opts: {},
            },
          ],
        });

        await job.remove({ removeChildren: false });

        await expect(children![0].job.removeChildDependency()).rejects.toThrow(
          `Missing key for parent job ${
            children![0].job.parentKey
          }. removeChildDependency`,
        );

        await flow.close();
      });
    });

    describe('when child does not exist', () => {
      it('throws an error', async () => {
        const flow = new FlowProducer({ connection, prefix });
        const { children } = await flow.add({
          name: 'parent',
          data: {},
          queueName,
          children: [
            {
              queueName,
              name: 'child0',
              data: {},
              opts: {},
            },
            {
              queueName,
              name: 'child1',
              data: {},
              opts: {},
            },
          ],
        });

        await children![0].job.remove();

        await expect(children![0].job.removeChildDependency()).rejects.toThrow(
          `Missing key for job ${children![0].job.id}. removeChildDependency`,
        );

        await flow.close();
      });
    });
  });

  describe('when ignoreDependencyOnFailure is provided', async () => {
    it('moves parent to wait after children fail', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const parentQueue = new Queue(parentQueueName, { connection, prefix });
      const name = 'child-job';

      const parentProcessor = async (job: Job) => {
        const values = await job.getDependencies({
          processed: {},
          ignored: {},
        });
        expect(values).toMatchObject({
          processed: {},
          nextProcessedCursor: 0,
        });
        expect(Object.keys(values.ignored!).length).toBe(3);
        expect(values.nextIgnoredCursor).toBe(0);
      };

      const parentWorker = new Worker(parentQueueName, parentProcessor, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(
        queueName,
        async () => {
          await delay(10);
          throw new Error('error');
        },
        {
          connection,
          prefix,
        },
      );
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const completed = new Promise<void>(resolve => {
        parentWorker.on('completed', async (job: Job) => {
          expect(job.finishedOn).to.be.string;
          const counts = await parentQueue.getJobCounts('completed');
          expect(counts.completed).toBe(1);
          resolve();
        });
      });

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          {
            name,
            data: { idx: 0, foo: 'bar' },
            queueName,
            opts: { ignoreDependencyOnFailure: true },
          },
          {
            name,
            data: { idx: 1, foo: 'baz' },
            queueName,
            opts: { ignoreDependencyOnFailure: true },
          },
          {
            name,
            data: { idx: 2, foo: 'qux' },
            queueName,
            opts: { ignoreDependencyOnFailure: true },
          },
        ],
      });

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).toEqual('waiting-children');
      expect(children).toHaveLength(3);

      expect(children![0].job.id).toBeTruthy();
      expect(children![0].job.data.foo).toEqual('bar');
      expect(children![1].job.id).toBeTruthy();
      expect(children![1].job.data.foo).toEqual('baz');
      expect(children![2].job.id).toBeTruthy();
      expect(children![2].job.data.foo).toEqual('qux');

      await completed;

      const { ignored } = await job.getDependenciesCount({ ignored: true });

      expect(ignored).toBe(3);

      const ignoredChildrenValues = await job.getIgnoredChildrenFailures();

      expect(ignoredChildrenValues).toEqual({
        [`${queue.qualifiedName}:${children![0].job.id}`]: 'error',
        [`${queue.qualifiedName}:${children![1].job.id}`]: 'error',
        [`${queue.qualifiedName}:${children![2].job.id}`]: 'error',
      });

      const flowTree = await flow.getFlow({
        id: job.id!,
        queueName: parentQueueName,
      });
      expect(flowTree.children?.length).toBe(3);

      await childrenWorker.close();
      await parentWorker.close();
      await flow.close();
      await parentQueue.close();

      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    }); // TODO: Add { timeout: 8000 } to the it() options
  });

  describe('when removeDependencyOnFailure is provided', async () => {
    it('moves parent to wait after children fail', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const parentQueue = new Queue(parentQueueName, { connection, prefix });
      const name = 'child-job';

      const parentProcessor = async (job: Job) => {
        const values = await job.getDependencies({
          processed: {},
        });
        expect(values).toEqual({
          processed: {},
          nextProcessedCursor: 0,
        });
      };

      const parentWorker = new Worker(parentQueueName, parentProcessor, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(
        queueName,
        async () => {
          await delay(10);
          throw new Error('error');
        },
        {
          connection,
          prefix,
        },
      );
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const completed = new Promise<void>(resolve => {
        parentWorker.on('completed', async (job: Job) => {
          expect(job.finishedOn).to.be.string;
          const counts = await parentQueue.getJobCounts('completed');
          expect(counts.completed).toBe(1);
          resolve();
        });
      });

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          {
            name,
            data: { idx: 0, foo: 'bar' },
            queueName,
            opts: { removeDependencyOnFailure: true },
          },
          {
            name,
            data: { idx: 1, foo: 'baz' },
            queueName,
            opts: { removeDependencyOnFailure: true },
          },
          {
            name,
            data: { idx: 2, foo: 'qux' },
            queueName,
            opts: { removeDependencyOnFailure: true },
          },
        ],
      });

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).toEqual('waiting-children');
      expect(children).toHaveLength(3);

      expect(children![0].job.id).toBeTruthy();
      expect(children![0].job.data.foo).toEqual('bar');
      expect(children![1].job.id).toBeTruthy();
      expect(children![1].job.data.foo).toEqual('baz');
      expect(children![2].job.id).toBeTruthy();
      expect(children![2].job.data.foo).toEqual('qux');

      await completed;
      await childrenWorker.close();
      await parentWorker.close();
      await flow.close();
      await parentQueue.close();

      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    }); // TODO: Add { timeout: 8000 } to the it() options
  });

  describe('when chaining flows at runtime using step jobs', () => {
    it('should wait children as one step of the parent job', async () => {
      // TODO: Move timeout to test options: { timeout: 8000 }
      const childrenQueueName = `children-queue-${v4()}`;
      const grandchildrenQueueName = `grandchildren-queue-${v4()}`;

      enum Step {
        Initial,
        Second,
        Third,
        Finish,
      }

      const flow = new FlowProducer({ connection, prefix });

      const childrenWorker = new Worker(
        childrenQueueName,
        async () => {
          await delay(10);
        },
        { connection, prefix },
      );
      const grandchildrenWorker = new Worker(
        grandchildrenQueueName,
        async () => {
          await delay(10);
        },
        { connection, prefix },
      );

      const worker = new Worker(
        queueName,
        async (job: Job, token?: string) => {
          let step = job.data.step;
          while (step !== Step.Finish) {
            switch (step) {
              case Step.Initial: {
                await flow.add({
                  name: 'child-job',
                  queueName: childrenQueueName,
                  data: {},
                  children: [
                    {
                      name: 'grandchild-job',
                      data: { idx: 0, foo: 'bar' },
                      queueName: grandchildrenQueueName,
                    },
                    {
                      name: 'grandchild-job',
                      data: { idx: 1, foo: 'baz' },
                      queueName: grandchildrenQueueName,
                    },
                  ],
                  opts: {
                    parent: {
                      id: job.id!,
                      queue: job.queueQualifiedName,
                    },
                  },
                });
                await job.updateData({
                  step: Step.Second,
                });
                step = Step.Second;
                break;
              }
              case Step.Second: {
                await job.updateData({
                  step: Step.Third,
                });
                step = Step.Third;
                break;
              }
              case Step.Third: {
                const shouldWait = await job.moveToWaitingChildren(token!);
                if (!shouldWait) {
                  await job.updateData({
                    step: Step.Finish,
                  });
                  step = Step.Finish;
                  return Step.Finish;
                } else {
                  throw new WaitingChildrenError();
                }
              }
              default: {
                throw new Error('invalid step');
              }
            }
          }
        },
        { connection, prefix },
      );
      await childrenWorker.waitUntilReady();
      await grandchildrenWorker.waitUntilReady();
      await worker.waitUntilReady();

      await queue.add(
        'test',
        { step: Step.Initial },
        {
          attempts: 3,
          backoff: 1000,
        },
      );

      await new Promise<void>(resolve => {
        worker.on('completed', job => {
          expect(job.returnvalue).toBe(Step.Finish);
          resolve();
        });
      });

      await flow.close();
      await worker.close();
      await childrenWorker.close();
      await grandchildrenWorker.close();
      await removeAllQueueData(new IORedis(redisHost), childrenQueueName);
      await removeAllQueueData(new IORedis(redisHost), grandchildrenQueueName);
    });

    describe('when parent has pending children to be processed when trying to move it to completed', () => {
      it('should fail parent with pending dependencies error', async () => {
        const childrenQueueName = `children-queue-${v4()}`;

        enum Step {
          Initial,
          Second,
          Third,
          Finish,
        }

        const flow = new FlowProducer({ connection, prefix });

        const worker = new Worker(
          queueName,
          async (job: Job, token?: string) => {
            let step = job.data.step;
            while (step !== Step.Finish) {
              switch (step) {
                case Step.Initial: {
                  await flow.add({
                    name: 'child-job',
                    queueName: childrenQueueName,
                    data: {},
                    opts: {
                      parent: {
                        id: job.id!,
                        queue: job.queueQualifiedName,
                      },
                    },
                  });
                  await job.updateData({
                    step: Step.Second,
                  });
                  step = Step.Second;
                  break;
                }
                case Step.Second: {
                  await job.updateData({
                    step: Step.Finish,
                  });
                  step = Step.Finish;
                  break;
                }
                default: {
                  throw new Error('invalid step');
                }
              }
            }
          },
          { autorun: false, connection, prefix },
        );
        const queueEvents = new QueueEvents(queueName, {
          connection,
          prefix,
        });
        await queueEvents.waitUntilReady();
        await worker.waitUntilReady();

        const job = await queue.add('test', { step: Step.Initial });

        const failed = new Promise<void>((resolve, rejects) => {
          queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
            try {
              if (jobId === job.id) {
                expect(prev).toBe('active');
                expect(failedReason).toBe(
                  `Job ${jobId} has pending dependencies. moveToFinished`,
                );
                resolve();
              }
            } catch (error) {
              rejects(error);
            }
          });
        });

        worker.run();
        await failed;

        await flow.close();
        await worker.close();
        await queueEvents.close();
        await removeAllQueueData(new IORedis(redisHost), childrenQueueName);
      });

      describe('when parent has pending children to be processed when trying to move it to completed', () => {
        it('should fail parent with pending dependencies error', async () => {
          const childrenQueueName = `children-queue-${v4()}`;

          enum Step {
            Initial,
            Second,
            Third,
            Finish,
          }

          const flow = new FlowProducer({ connection, prefix });

          const worker = new Worker(
            queueName,
            async (job: Job, token?: string) => {
              let step = job.data.step;
              while (step !== Step.Finish) {
                switch (step) {
                  case Step.Initial: {
                    await flow.add({
                      name: 'child-job',
                      queueName: childrenQueueName,
                      data: {},
                      opts: {
                        parent: {
                          id: job.id!,
                          queue: job.queueQualifiedName,
                        },
                        failParentOnFailure: true,
                      },
                    });
                    await job.updateData({
                      step: Step.Second,
                    });
                    step = Step.Second;
                    break;
                  }
                  case Step.Second: {
                    await delay(100);
                    await job.updateData({
                      step: Step.Finish,
                    });
                    step = Step.Finish;
                    break;
                  }
                  default: {
                    throw new Error('invalid step');
                  }
                }
              }
            },
            { autorun: false, connection, prefix },
          );
          const queueEvents = new QueueEvents(queueName, {
            connection,
            prefix,
          });
          await queueEvents.waitUntilReady();
          await worker.waitUntilReady();

          const job = await queue.add('test', { step: Step.Initial });

          const failed = new Promise<void>((resolve, rejects) => {
            queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
              try {
                if (jobId === job.id) {
                  expect(prev).toBe('active');
                  expect(failedReason).toBe(
                    `Job ${jobId} has pending dependencies. moveToFinished`,
                  );
                  resolve();
                }
              } catch (error) {
                rejects(error);
              }
            });
          });

          worker.run();
          await failed;

          await flow.close();
          await worker.close();
          await queueEvents.close();
          await removeAllQueueData(new IORedis(redisHost), childrenQueueName);
        });
      });
    });

    describe('when parent is not in waiting-children state when one child with failParentOnFailure failed', () => {
      it('should fail parent when trying to move it to waiting children', async () => {
        const childrenQueueName = `children-queue-${v4()}`;
        const grandchildrenQueueName = `grandchildren-queue-${v4()}`;

        enum Step {
          Initial,
          Second,
          Third,
          Finish,
        }

        const flow = new FlowProducer({ connection, prefix });

        const grandchildrenWorker = new Worker(
          grandchildrenQueueName,
          async () => {
            throw new Error('fail');
          },
          { connection, prefix },
        );

        const childrenWorker = new Worker(childrenQueueName, async () => {}, {
          connection,
          prefix,
        });

        const worker = new Worker(
          queueName,
          async (job: Job, token?: string) => {
            let step = job.data.step;
            while (step !== Step.Finish) {
              switch (step) {
                case Step.Initial: {
                  await flow.add({
                    name: 'child-job',
                    queueName: childrenQueueName,
                    data: {},
                    children: [
                      {
                        name: 'grandchild-job',
                        data: { idx: 0, foo: 'bar' },
                        queueName: grandchildrenQueueName,
                        opts: {
                          failParentOnFailure: true,
                        },
                      },
                    ],
                    opts: {
                      parent: {
                        id: job.id!,
                        queue: job.queueQualifiedName,
                      },
                      failParentOnFailure: true,
                    },
                  });
                  await job.updateData({
                    step: Step.Second,
                  });
                  step = Step.Second;
                  break;
                }
                case Step.Second: {
                  await job.updateData({
                    step: Step.Third,
                  });
                  step = Step.Third;
                  break;
                }
                case Step.Third: {
                  await delay(1000);
                  const shouldWait = await job.moveToWaitingChildren(token!);
                  if (!shouldWait) {
                    await job.updateData({
                      step: Step.Finish,
                    });
                    step = Step.Finish;
                    return Step.Finish;
                  } else {
                    throw new WaitingChildrenError();
                  }
                }
                default: {
                  throw new Error('invalid step');
                }
              }
            }
          },
          { connection, prefix },
        );
        const queueEvents = new QueueEvents(queueName, {
          connection,
          prefix,
        });
        await queueEvents.waitUntilReady();
        await grandchildrenWorker.waitUntilReady();
        await childrenWorker.waitUntilReady();
        await worker.waitUntilReady();

        const job = await queue.add(
          'test',
          { step: Step.Initial },
          {
            attempts: 3,
            backoff: 1000,
          },
        );

        const failed = new Promise<void>((resolve, rejects) => {
          queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
            try {
              if (jobId === job.id) {
                expect(prev).toBe('active');
                expect(failedReason).toBe(
                  `Cannot complete job ${jobId} because it has at least one failed child. moveToWaitingChildren`,
                );
                const activeCount = await queue.getActiveCount();
                expect(activeCount).toBe(0);
                const childrenCounts = await job.getDependenciesCount();
                expect(childrenCounts).toEqual({
                  processed: 0,
                  unprocessed: 0,
                  ignored: 0,
                  failed: 1,
                });
                resolve();
              }
            } catch (error) {
              rejects(error);
            }
          });
        });

        const workerFailedEvent = new Promise<void>((resolve, rejects) => {
          worker.once('failed', async job => {
            try {
              expect(job!.failedReason).toBe(
                `Cannot complete job ${job!.id} because it has at least one failed child. moveToWaitingChildren`,
              );
              resolve();
            } catch (error) {
              rejects(error);
            }
          });
        });

        await workerFailedEvent;
        await failed;

        await flow.close();
        await worker.close();
        await grandchildrenWorker.close();
        await childrenWorker.close();
        await queueEvents.close();
      });

      describe('when parent has another parent', () => {
        it('should fail parent and grandparent when trying to move it to waiting children', async () => {
          const childrenQueueName = `children-queue-${v4()}`;
          const grandchildrenQueueName = `grandchildren-queue-${v4()}`;

          enum Step {
            Initial,
            Second,
            Finish,
          }

          const flow = new FlowProducer({ connection, prefix });

          const grandchildrenWorker = new Worker(
            grandchildrenQueueName,
            async () => {
              throw new Error('fail');
            },
            { connection, prefix },
          );

          const childrenWorker = new Worker(
            childrenQueueName,
            async (job: Job, token?: string) => {
              let step = job.data.step;
              while (step !== Step.Finish) {
                switch (step) {
                  case Step.Initial: {
                    await flow.add({
                      name: 'grandchild-job',
                      data: { idx: 0, foo: 'bar' },
                      queueName: grandchildrenQueueName,
                      opts: {
                        parent: {
                          id: job.id!,
                          queue: job.queueQualifiedName,
                        },
                        failParentOnFailure: true,
                      },
                    });
                    await job.updateData({
                      step: Step.Second,
                    });
                    step = Step.Second;
                    break;
                  }
                  case Step.Second: {
                    await delay(1000);
                    const shouldWait = await job.moveToWaitingChildren(token!);
                    if (!shouldWait) {
                      await job.updateData({
                        step: Step.Finish,
                      });
                      step = Step.Finish;
                      return Step.Finish;
                    } else {
                      throw new WaitingChildrenError();
                    }
                  }
                  default: {
                    throw new Error('invalid step');
                  }
                }
              }
            },
            {
              connection,
              prefix,
            },
          );

          const worker = new Worker(
            queueName,
            async (job: Job, token?: string) => {
              let step = job.data.step;
              while (step !== Step.Finish) {
                switch (step) {
                  case Step.Initial: {
                    await flow.add({
                      name: 'child-job',
                      queueName: childrenQueueName,
                      data: {},
                      opts: {
                        parent: {
                          id: job.id!,
                          queue: job.queueQualifiedName,
                        },
                        failParentOnFailure: true,
                      },
                    });
                    await job.updateData({
                      step: Step.Second,
                    });
                    step = Step.Second;
                    break;
                  }
                  case Step.Second: {
                    await delay(1000);
                    const shouldWait = await job.moveToWaitingChildren(token!);
                    if (!shouldWait) {
                      await job.updateData({
                        step: Step.Finish,
                      });
                      step = Step.Finish;
                      return Step.Finish;
                    } else {
                      throw new WaitingChildrenError();
                    }
                  }
                  default: {
                    throw new Error('invalid step');
                  }
                }
              }
            },
            { connection, prefix },
          );
          const queueEvents = new QueueEvents(queueName, {
            connection,
            prefix,
          });
          await queueEvents.waitUntilReady();
          await grandchildrenWorker.waitUntilReady();
          await childrenWorker.waitUntilReady();
          await worker.waitUntilReady();

          const job = await queue.add(
            'test',
            { step: Step.Initial },
            {
              attempts: 3,
              backoff: 1000,
            },
          );

          const failed = new Promise<void>(resolve => {
            queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
              if (jobId === job.id) {
                expect(prev).toBe('active');
                expect(failedReason).toBe(
                  `Cannot complete job ${jobId} because it has at least one failed child. moveToWaitingChildren`,
                );
                const childrenCounts = await job.getDependenciesCount();
                expect(childrenCounts).toEqual({
                  processed: 0,
                  unprocessed: 0,
                  ignored: 0,
                  failed: 1,
                });
                resolve();
              }
            });
          });

          const workerFailedEvent = new Promise<void>(resolve => {
            worker.once('failed', async job => {
              expect(job!.failedReason).toBe(
                `Cannot complete job ${job.id} because it has at least one failed child. moveToWaitingChildren`,
              );
              resolve();
            });
          });

          await workerFailedEvent;
          await failed;

          await flow.close();
          await worker.close();
          await grandchildrenWorker.close();
          await childrenWorker.close();
          await queueEvents.close();
        });
      });
    });

    describe('when parent failed before moving to waiting-children', () => {
      it('should fail parent with last error', async () => {
        const childrenQueueName = `children-queue-${v4()}`;
        const grandchildrenQueueName = `grandchildren-queue-${v4()}`;

        enum Step {
          Initial,
          Second,
          Third,
          Finish,
        }

        const flow = new FlowProducer({ connection, prefix });

        const grandchildrenWorker = new Worker(
          grandchildrenQueueName,
          async () => {
            throw new Error('fail');
          },
          { connection, prefix },
        );

        const worker = new Worker(
          queueName,
          async (job: Job, token?: string) => {
            let step = job.data.step;
            while (step !== Step.Finish) {
              switch (step) {
                case Step.Initial: {
                  await flow.add({
                    name: 'child-job',
                    queueName: childrenQueueName,
                    data: {},
                    children: [
                      {
                        name: 'grandchild-job',
                        data: { idx: 0, foo: 'bar' },
                        queueName: grandchildrenQueueName,
                        opts: {
                          failParentOnFailure: true,
                        },
                      },
                    ],
                    opts: {
                      parent: {
                        id: job.id!,
                        queue: job.queueQualifiedName,
                      },
                      failParentOnFailure: true,
                    },
                  });
                  await job.updateData({
                    step: Step.Second,
                  });
                  step = Step.Second;
                  break;
                }
                case Step.Second: {
                  await job.updateData({
                    step: Step.Third,
                  });
                  step = Step.Third;

                  throw new Error('fail');
                }
                case Step.Third: {
                  const shouldWait = await job.moveToWaitingChildren(token!);
                  if (!shouldWait) {
                    await job.updateData({
                      step: Step.Finish,
                    });
                    step = Step.Finish;
                    return Step.Finish;
                  } else {
                    throw new WaitingChildrenError();
                  }
                }
                default: {
                  throw new Error('invalid step');
                }
              }
            }
          },
          { connection, prefix },
        );
        const queueEvents = new QueueEvents(queueName, {
          connection,
          prefix,
        });
        await queueEvents.waitUntilReady();
        await grandchildrenWorker.waitUntilReady();
        await worker.waitUntilReady();

        const job = await queue.add('test', { step: Step.Initial });

        const failed = new Promise<void>(resolve => {
          queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
            if (jobId === job.id) {
              expect(prev).toBe('active');
              expect(failedReason).toBe('fail');
              resolve();
            }
          });
        });

        await failed;

        await flow.close();
        await worker.close();
        await grandchildrenWorker.close();
        await queueEvents.close();
      });
    });
  });

  describe('when moving jobs from wait to active continuing', async () => {
    it('begins with attemptsMade as 1', async () => {
      let parentProcessor,
        counter = 0;

      const processingParent = new Promise<void>(resolve => [
        (parentProcessor = async (job: Job) => {
          switch (job.name) {
            case 'task3': {
              if (job.attemptsMade + 1 != job.opts.attempts) {
                throw {};
              }
              counter++;
              if (counter === 3) {
                resolve();
              }
              break;
            }
            case 'task2': {
              if (job.attemptsMade + 1 != job.opts.attempts) {
                throw {};
              }
              counter++;
              break;
            }
          }
        }),
      ]);

      const parentWorker = new Worker(queueName, parentProcessor, {
        connection,
        prefix,
      });
      const delayTime = 1000;
      await parentWorker.waitUntilReady();

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'task3',
        data: { status: 'plan' },
        opts: { attempts: 1, backoff: { type: 'fixed', delay: delayTime } },
        queueName,
        children: [
          {
            name: 'task2',
            data: {},
            queueName,
            opts: { attempts: 1, backoff: { type: 'fixed', delay: delayTime } },
            children: [
              {
                name: 'task3',
                data: { status: 'proposal' },
                opts: {
                  attempts: 1,
                  backoff: { type: 'fixed', delay: delayTime },
                },
                queueName,
              },
            ],
          },
        ],
      });

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).toEqual('waiting-children');
      expect(children).toHaveLength(1);

      await processingParent;

      await parentWorker.close();

      await flow.close();

      const count = await queue.getJobCountByTypes('completed');

      expect(count).toEqual(3);
    });
  });

  describe('when defaultJobOptions is provided', async () => {
    it('processes children before the parent', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const parentQueue = new Queue(parentQueueName, { connection, prefix });
      const name = 'child-job';
      const values = [
        { bar: 'something' },
        { baz: 'something' },
        { qux: 'something' },
      ];

      let childrenProcessor,
        processedChildren = 0;
      const processingChildren = new Promise<void>(
        resolve =>
          (childrenProcessor = async (job: Job) => {
            processedChildren++;

            if (processedChildren == values.length) {
              resolve();
            }
            return values[job.data.idx];
          }),
      );

      const parentProcessor = async (job: Job) => {
        const { processed, nextProcessedCursor } = await job.getDependencies({
          processed: {},
        });
        expect(nextProcessedCursor).toBe(0);
        expect(Object.keys(processed)).toHaveLength(3);

        const childrenValues = await job.getChildrenValues();

        for (let i = 0; i < values.length; i++) {
          const jobKey = queue.toKey(tree.children[i].job.id);
          expect(childrenValues[jobKey]).to.be.deep.equal(values[i]);
        }
      };

      const parentWorker = new Worker(parentQueueName, parentProcessor, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
        prefix,
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const completed = new Promise<void>(resolve => {
        parentWorker.on('completed', async (job: Job) => {
          expect(job.finishedOn).to.be.string;
          const gotJob = await parentQueue.getJob(job.id);
          expect(gotJob).toBeUndefined();
          const counts = await parentQueue.getJobCounts('completed');
          expect(counts.completed).toBe(0);
          resolve();
        });
      });

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add(
        {
          name: 'parent-job',
          queueName: parentQueueName,
          data: {},
          children: [
            { name, data: { idx: 0, foo: 'bar' }, queueName },
            { name, data: { idx: 1, foo: 'baz' }, queueName },
            { name, data: { idx: 2, foo: 'qux' }, queueName },
          ],
        },
        {
          queuesOptions: {
            [parentQueueName]: {
              defaultJobOptions: {
                removeOnComplete: true,
              },
            },
          },
        },
      );

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).toEqual('waiting-children');
      expect(children).toHaveLength(3);

      expect(children[0].job.id).toBeTruthy();
      expect(children[0].job.data.foo).toEqual('bar');
      expect(children[0].job.parent).toEqual({
        id: job.id,
        queueKey: `${prefix}:${parentQueueName}`,
      });
      expect(children[1].job.id).toBeTruthy();
      expect(children[1].job.data.foo).toEqual('baz');
      expect(children[2].job.id).toBeTruthy();
      expect(children[2].job.data.foo).toEqual('qux');

      await processingChildren;
      await childrenWorker.close();

      await completed;
      await parentWorker.close();
      await parentQueue.close();

      await flow.close();

      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });
  });

  describe('when priority is provided', async () => {
    it('processes children before the parent respecting priority option', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const grandchildrenQueueName = `grandchildren-queue-${v4()}`;
      const parentQueue = new Queue(parentQueueName, { connection, prefix });
      const parentName = 'parent-job';
      const grandchildrenName = 'grandchildren-job';
      const name = 'child-job';
      const values = [
        { bar: 'something' },
        { baz: 'something' },
        { qux: 'something' },
      ];

      let childrenProcessor,
        grandChildrenProcessor,
        processedChildren = 0,
        processedGrandChildren = 0;
      const processingChildren = new Promise<void>(
        resolve =>
          (childrenProcessor = async (job: Job) => {
            if (job.data.idx !== undefined) {
              expect(job.data.idx).toBe(processedChildren);
              processedChildren++;

              if (processedChildren == values.length) {
                resolve();
              }
              return values[job.data.idx];
            }

            if (job.name === 'test') {
              await delay(500);
            }
          }),
      );

      const processingGrandChildren = new Promise<void>(
        resolve =>
          (grandChildrenProcessor = async () => {
            processedGrandChildren++;
            await delay(50);

            if (processedGrandChildren == 3) {
              resolve();
            }
          }),
      );

      const parentProcessor = async (job: Job) => {
        const { processed, nextProcessedCursor } = await job.getDependencies({
          processed: {},
        });
        expect(nextProcessedCursor).toBe(0);
        expect(Object.keys(processed)).toHaveLength(3);

        const childrenValues = await job.getChildrenValues();
        expect(Object.keys(childrenValues).length).toBe(3);
      };

      const parentWorker = new Worker(parentQueueName, parentProcessor, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
        prefix,
        autorun: false,
      });
      const grandchildrenWorker = new Worker(
        grandchildrenQueueName,
        grandChildrenProcessor,
        {
          connection,
          prefix,
        },
      );
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();
      await grandchildrenWorker.waitUntilReady();

      const completed = new Promise<void>(resolve => {
        parentWorker.on('completed', async (job: Job) => {
          expect(job.finishedOn).to.be.string;
          const gotJob = await parentQueue.getJob(job.id);
          expect(gotJob).toBeUndefined();
          const counts = await parentQueue.getJobCounts('completed');
          expect(counts.completed).toBe(0);
          resolve();
        });
      });

      await queue.add('test', {});
      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add(
        {
          name: parentName,
          queueName: parentQueueName,
          data: {},
          children: [
            {
              name,
              data: { idx: 1, foo: 'baz' },
              queueName,
              children: [
                {
                  name: grandchildrenName,
                  data: {},
                  queueName: grandchildrenQueueName,
                },
              ],
              opts: { priority: 2 },
            },
            {
              name,
              data: { idx: 2, foo: 'qux' },
              queueName,
              children: [
                {
                  name: grandchildrenName,
                  data: {},
                  queueName: grandchildrenQueueName,
                },
              ],
              opts: { priority: 3 },
            },
            {
              name,
              data: { idx: 0, foo: 'bar' },
              queueName,
              children: [
                {
                  name: grandchildrenName,
                  data: {},
                  queueName: grandchildrenQueueName,
                },
              ],
              opts: { priority: 1 },
            },
          ],
        },
        {
          queuesOptions: {
            [parentQueueName]: {
              defaultJobOptions: {
                removeOnComplete: true,
              },
            },
          },
        },
      );

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).toEqual('waiting-children');
      expect(children).toHaveLength(3);

      expect(children[0].job.id).toBeTruthy();
      expect(children[0].job.data.foo).toEqual('baz');
      expect(children[0].job.parent).toEqual({
        id: job.id,
        queueKey: `${prefix}:${parentQueueName}`,
      });
      expect(children[1].job.id).toBeTruthy();
      expect(children[1].job.data.foo).toEqual('qux');
      expect(children[2].job.id).toBeTruthy();
      expect(children[2].job.data.foo).toEqual('bar');

      await processingGrandChildren;

      childrenWorker.run();

      await processingChildren;
      await childrenWorker.close();

      await completed;
      await parentWorker.close();
      await grandchildrenWorker.close();
      await parentQueue.close();

      await flow.close();

      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
      await removeAllQueueData(new IORedis(redisHost), grandchildrenQueueName);
    }); // TODO: Add { timeout: 8000 } to the it() options
  });

  describe('when backoff strategy is provided', async () => {
    it('retries a job after a delay if a fixed backoff is given', async () => {
      const name = 'child-job';
      const values = [{ bar: 'something' }];

      const parentQueueName = `parent-queue-${v4()}`;

      let childrenProcessor,
        parentProcessor,
        processedChildren = 0;
      const processingChildren = new Promise<void>(
        resolve =>
          (childrenProcessor = async (job: Job) => {
            if (job.attemptsMade < 1) {
              throw new Error('Not yet!');
            }
            processedChildren++;

            if (processedChildren == values.length) {
              resolve();
            }
            return values[job.data.idx];
          }),
      );

      const processingParent = new Promise<void>((resolve, reject) => [
        (parentProcessor = async () => {
          try {
            resolve();
          } catch (err) {
            console.error(err);
            reject(err);
          }
        }),
      ]);

      const parentWorker = new Worker(parentQueueName, parentProcessor, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
        prefix,
        settings: {
          backoffStrategy: (attemptsMade: number) => {
            return attemptsMade * 500;
          },
        },
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          {
            name,
            data: { idx: 0, foo: 'bar' },
            queueName,
            opts: {
              attempts: 3,
              backoff: {
                type: 'custom',
              },
            },
          },
        ],
      });

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).toEqual('waiting-children');
      expect(children).toHaveLength(1);

      expect(children[0].job.id).toBeTruthy();
      expect(children[0].job.data.foo).toEqual('bar');

      await processingChildren;
      await childrenWorker.close();

      await processingParent;
      await parentWorker.close();

      await flow.close();

      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });
  });

  describe('when continually adding jobs', async () => {
    it('adds jobs that do not exists', async () => {
      const worker = new Worker(queueName, async () => {}, {
        autorun: false,
        connection,
        prefix,
      });

      const completing1 = new Promise<void>(resolve => {
        worker.on('completed', (job: Job) => {
          if (job.id === 'wed') {
            resolve();
          }
        });
      });

      const flow = new FlowProducer({ connection, prefix });
      await flow.add({
        queueName,
        name: 'tue',
        opts: {
          jobId: 'tue',
        },
        children: [
          {
            name: 'mon',
            queueName,
            opts: {
              jobId: 'mon',
            },
          },
        ],
      });

      await flow.add({
        queueName,
        name: 'wed',
        opts: {
          jobId: 'wed',
        },
        children: [
          {
            name: 'tue',
            queueName,
            opts: {
              jobId: 'tue',
            },
          },
        ],
      });

      worker.run();

      await completing1;

      const completing2 = new Promise<void>(resolve => {
        worker.on('completed', (job: Job) => {
          if (job.id === 'thu') {
            resolve();
          }
        });
      });

      const tree = await flow.add({
        queueName,
        name: 'thu',
        opts: {
          jobId: 'thu',
        },
        children: [
          {
            name: 'wed',
            queueName,
            opts: {
              jobId: 'wed',
            },
          },
        ],
      });

      await completing2;

      const state = await tree.job.getState();

      expect(state).toBe('completed');

      await worker.close();
      await flow.close();
    });

    it('processes parent jobs added while a child job is active', async () => {
      // TODO: Move timeout to test options: { timeout: 10_000 }

      const worker = new Worker(
        queueName,
        async () => {
          await new Promise(s => {
            setTimeout(s, 1_000);
          });
        },
        {
          connection,
          prefix,
        },
      );

      const completing = new Promise<void>(resolve => {
        worker.on('completed', (job: Job) => {
          if (job.id === 'tue') {
            resolve();
          }
        });
      });

      const flow = new FlowProducer({ connection, prefix });
      await flow.add({
        queueName,
        name: 'mon',
        opts: {
          jobId: 'mon',
        },
        children: [],
      });

      await new Promise(s => {
        setTimeout(s, 500);
      });

      const tree = await flow.add({
        queueName,
        name: 'tue',
        opts: {
          jobId: 'tue',
        },
        children: [
          {
            name: 'mon',
            queueName,
            opts: {
              jobId: 'mon',
            },
          },
        ],
      });

      await completing;

      const state = await tree.job.getState();

      expect(state).toBe('completed');

      await worker.close();
      await flow.close();
    });

    describe('when job already have a parent', async () => {
      it('throws an error', async () => {
        const flow = new FlowProducer({ connection, prefix });
        await flow.add({
          queueName,
          name: 'tue',
          opts: {
            jobId: 'tue',
          },
          children: [
            {
              name: 'mon',
              queueName,
              opts: {
                jobId: 'mon',
              },
            },
          ],
        });

        await queue.add(
          'wed',
          {},
          {
            jobId: 'wed',
          },
        );

        await expect(
          queue.add(
            'mon',
            {},
            {
              jobId: 'mon',
              parent: {
                id: 'wed',
                queue: `${prefix}:${queueName}`,
              },
            },
          ),
        ).rejects.toThrow(
          `The parent job ${prefix}:${queueName}:wed cannot be replaced. addJob`,
        );

        await flow.close();
      });
    });

    describe('when child already existed and it is re-added with same parentId', async () => {
      it('moves parent to wait if child is already completed', async () => {
        const worker = new Worker(
          queueName,
          async () => {
            await new Promise(s => {
              setTimeout(s, 250);
            });
          },
          {
            connection,
            prefix,
          },
        );

        const completing = new Promise<void>(resolve => {
          worker.on('completed', (job: Job) => {
            if (job.id === 'tue') {
              resolve();
            }
          });
        });

        const flow = new FlowProducer({ connection, prefix });

        await flow.add({
          queueName,
          name: 'tue',
          opts: {
            jobId: 'tue',
            removeOnComplete: true,
          },
          children: [
            {
              name: 'mon',
              queueName,
              opts: {
                jobId: 'mon',
              },
            },
          ],
        });

        await completing;

        const tree = await flow.add({
          queueName,
          name: 'tue',
          opts: {
            jobId: 'tue',
          },
          children: [
            {
              name: 'mon',
              queueName,
              opts: {
                jobId: 'mon',
              },
            },
          ],
        });

        await delay(1000);
        const state = await tree.job.getState();

        expect(state).toBe('completed');

        await worker.close();
        await flow.close();
      });
    });
  });

  describe('when custom prefix is set in flow producer', async () => {
    it('uses default prefix to add jobs', async () => {
      const customPrefix = '{bull}';
      const childrenQueue = new Queue(queueName, {
        prefix: customPrefix,
        connection,
      });

      const name = 'child-job';
      const values = [{ bar: 'something' }];

      const parentQueueName = `parent-queue-${v4()}`;

      let childrenProcessor,
        parentProcessor,
        processedChildren = 0;
      const processingChildren = new Promise<void>(
        resolve =>
          (childrenProcessor = async (job: Job) => {
            processedChildren++;
            await delay(10);

            if (processedChildren == values.length) {
              resolve();
            }
            return values[job.data.idx];
          }),
      );

      const processingParent = new Promise<void>((resolve, reject) => [
        (parentProcessor = async (job: Job) => {
          try {
            const { processed, nextProcessedCursor } =
              await job.getDependencies({
                processed: {},
              });
            expect(nextProcessedCursor).toBe(0);
            expect(Object.keys(processed)).toHaveLength(1);

            const childrenValues = await job.getChildrenValues();

            for (let i = 0; i < values.length; i++) {
              const jobKey = childrenQueue.toKey(tree.children[i].job.id);
              expect(childrenValues[jobKey]).to.be.deep.equal(values[i]);
            }
            resolve();
          } catch (err) {
            console.error(err);
            reject(err);
          }
        }),
      ]);

      const parentWorker = new Worker(parentQueueName, parentProcessor, {
        connection,
        prefix: customPrefix,
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
        prefix: customPrefix,
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const flow = new FlowProducer({ prefix: customPrefix, connection });
      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [{ name, data: { idx: 0, foo: 'bar' }, queueName }],
      });

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).toEqual('waiting-children');
      expect(children).toHaveLength(1);

      expect(children[0].job.id).toBeTruthy();
      expect(children[0].job.data.foo).toEqual('bar');

      await processingChildren;
      await childrenWorker.close();

      await processingParent;
      await parentWorker.close();

      await flow.close();
      await childrenQueue.close();
      await removeAllQueueData(
        new IORedis(redisHost),
        parentQueueName,
        customPrefix,
      );
      await removeAllQueueData(new IORedis(redisHost), queueName, customPrefix);
    });
  });

  describe('when priority option is provided', async () => {
    it('should process children before the parent prioritizing jobs per queueName', async () => {
      const name = 'child-job';
      const values = [
        { bar: 'something' },
        { baz: 'something' },
        { qux: 'something' },
      ];

      const parentQueueName = `parent-queue-${v4()}`;
      const grandChildrenQueueName = `grand-children-queue-${v4()}`;

      let grandChildrenProcessor,
        childrenProcessor,
        parentProcessor,
        processedGrandChildren = 0,
        processedChildren = 0;
      const processingChildren = new Promise<void>(resolve => {
        childrenProcessor = async (job: Job) => {
          processedChildren++;
          await delay(25);
          expect(processedChildren).toBe(job.data.order);

          if (processedChildren === 3) {
            resolve();
          }
          return values[job.data.order - 1];
        };
      });

      const processingGrandchildren = new Promise<void>(resolve => {
        grandChildrenProcessor = async (job: Job) => {
          processedGrandChildren++;
          await delay(25);
          expect(processedGrandChildren).toBe(job.data.order);

          if (processedGrandChildren === 3) {
            resolve();
          }
          return values[job.data.order - 1];
        };
      });

      const processingParent = new Promise<void>((resolve, reject) => [
        (parentProcessor = async (job: Job) => {
          try {
            const { processed, nextProcessedCursor } =
              await job.getDependencies({
                processed: {},
              });
            expect(nextProcessedCursor).toBe(0);
            expect(Object.keys(processed)).toHaveLength(3);

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

      const parentWorker = new Worker(parentQueueName, parentProcessor, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        autorun: false,
        connection,
        prefix,
      });
      const grandChildrenWorker = new Worker(
        grandChildrenQueueName,
        grandChildrenProcessor,
        { autorun: false, connection, prefix },
      );

      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();
      await grandChildrenWorker.waitUntilReady();

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          {
            name,
            data: { order: 1, foo: 'bar' },
            queueName,
            opts: { priority: 1 },
          },
          {
            name,
            data: { order: 2, foo: 'baz' },
            queueName,
            opts: { priority: 2 },
          },
          {
            name,
            data: { order: 3, foo: 'qux' },
            queueName,
            opts: { priority: 3 },
            children: [
              {
                name,
                data: { order: 1, foo: 'bar' },
                queueName: grandChildrenQueueName,
                opts: { priority: 1 },
              },
              {
                name,
                data: { order: 2, foo: 'baz' },
                queueName: grandChildrenQueueName,
                opts: { priority: 2 },
              },
              {
                name,
                data: { order: 3, foo: 'qux' },
                queueName: grandChildrenQueueName,
                opts: { priority: 3 },
              },
            ],
          },
        ],
      });

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).toEqual('waiting-children');
      expect(children).toHaveLength(3);

      grandChildrenWorker.run();

      await processingGrandchildren;

      childrenWorker.run();

      await processingChildren;
      await processingParent;

      await grandChildrenWorker.close();
      await childrenWorker.close();
      await parentWorker.close();

      await flow.close();

      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
      await removeAllQueueData(new IORedis(redisHost), grandChildrenQueueName);
    }); // TODO: Add { timeout: 8000 } to the it() options
  });

  describe('when failParentOnFailure option is provided', async () => {
    describe('when parent is in waiting-children state', async () => {
      it('should move parent to failed when child is moved to failed', async () => {
        const name = 'child-job';

        const parentQueueName = `parent-queue-${v4()}`;
        const grandChildrenQueueName = `grand-children-queue-${v4()}`;

        const parentQueue = new Queue(parentQueueName, {
          connection,
          prefix,
        });
        const grandChildrenQueue = new Queue(grandChildrenQueueName, {
          connection,
          prefix,
        });
        const queueEvents = new QueueEvents(parentQueueName, {
          connection,
          prefix,
        });
        await queueEvents.waitUntilReady();

        let grandChildrenProcessor,
          processedGrandChildren = 0;
        const processingChildren = new Promise<void>(resolve => {
          grandChildrenProcessor = async () => {
            processedGrandChildren++;

            if (processedGrandChildren === 2) {
              return resolve();
            }

            await delay(200);

            throw new Error('failed');
          };
        });

        const grandChildrenWorker = new Worker(
          grandChildrenQueueName,
          grandChildrenProcessor,
          { connection, prefix },
        );
        const childrenWorker = new Worker(queueName, async () => {}, {
          connection,
          prefix,
        });
        const parentWorker = new Worker(parentQueueName, async () => {}, {
          connection,
          prefix,
        });

        await grandChildrenWorker.waitUntilReady();
        await childrenWorker.waitUntilReady();
        await parentWorker.waitUntilReady();

        const flow = new FlowProducer({ connection, prefix });
        const tree = await flow.add({
          name: 'parent-job',
          queueName: parentQueueName,
          data: {},
          children: [
            {
              name,
              data: { foo: 'bar' },
              queueName,
            },
            {
              name,
              data: { foo: 'qux' },
              queueName,
              opts: { failParentOnFailure: true },
              children: [
                {
                  name,
                  data: { foo: 'bar' },
                  queueName: grandChildrenQueueName,
                  opts: { failParentOnFailure: true },
                },
                {
                  name,
                  data: { foo: 'baz' },
                  queueName: grandChildrenQueueName,
                },
              ],
            },
          ],
        });

        const failed = new Promise<void>(resolve => {
          queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
            if (jobId === tree.job.id) {
              expect(prev).toBe('active');
              expect(failedReason).toBe(
                `child ${prefix}:${queueName}:${tree.children[1].job.id} failed`,
              );
              resolve();
            }
          });
        });

        expect(tree).toHaveProperty('job');
        expect(tree).toHaveProperty('children');

        const { children, job } = tree;
        const parentState = await job.getState();

        expect(parentState).toEqual('waiting-children');

        await processingChildren;
        await failed;

        const { failed: failedCount } = await job.getDependenciesCount({
          failed: true,
        });

        expect(failedCount).toBe(1);

        const flowTree = await flow.getFlow({
          id: job.id!,
          queueName: parentQueueName,
        });
        expect(flowTree.children?.length).toBe(2);

        const { children: grandChildren } = children[1];
        const updatedGrandchildJob = await grandChildrenQueue.getJob(
          grandChildren[0].job.id,
        );
        const grandChildState = await updatedGrandchildJob.getState();

        expect(grandChildState).toEqual('failed');
        expect(updatedGrandchildJob.failedReason).toEqual('failed');

        const updatedParentJob = await queue.getJob(children[1].job.id);
        const updatedParentState = await updatedParentJob.getState();

        expect(updatedParentState).toEqual('failed');
        expect(updatedParentJob.failedReason).toEqual(
          `child ${prefix}:${grandChildrenQueueName}:${updatedGrandchildJob.id} failed`,
        );

        const updatedGrandparentJob = await parentQueue.getJob(job.id);
        const updatedGrandparentState = await updatedGrandparentJob.getState();

        expect(updatedGrandparentState).toEqual('failed');
        expect(updatedGrandparentJob.failedReason).toEqual(
          `child ${prefix}:${queueName}:${updatedParentJob.id} failed`,
        );

        await parentQueue.close();
        await grandChildrenQueue.close();
        await grandChildrenWorker.close();
        await childrenWorker.close();
        await parentWorker.close();
        await flow.close();
        await queueEvents.close();

        await removeAllQueueData(new IORedis(redisHost), parentQueueName);
        await removeAllQueueData(
          new IORedis(redisHost),
          grandChildrenQueueName,
        );
      });
    });

    describe('when parent is in delayed state', async () => {
      it('should move parent to failed when child is moved to failed', async () => {
        const childrenQueueName = `children-queue-${v4()}`;
        const grandchildrenQueueName = `grandchildren-queue-${v4()}`;

        enum Step {
          Initial,
          Second,
          Third,
          Finish,
        }

        const flow = new FlowProducer({ connection, prefix });

        const grandchildrenWorker = new Worker(
          grandchildrenQueueName,
          async () => {
            await delay(500);
            throw new Error('failed');
          },
          { connection, prefix },
        );
        const childrenWorker = new Worker(childrenQueueName, async () => {}, {
          connection,
          prefix,
        });

        const queueEvents = new QueueEvents(queueName, {
          connection,
          prefix,
        });
        await queueEvents.waitUntilReady();

        let childId;
        const worker = new Worker(
          queueName,
          async (job: Job, token?: string) => {
            let step = job.data.step;
            while (step !== Step.Finish) {
              switch (step) {
                case Step.Initial: {
                  const { job: child } = await flow.add({
                    name: 'child-job',
                    queueName: childrenQueueName,
                    data: {},
                    children: [
                      {
                        name: 'grandchild-job',
                        data: { idx: 0, foo: 'bar' },
                        queueName: grandchildrenQueueName,
                        opts: {
                          failParentOnFailure: true,
                        },
                      },
                    ],
                    opts: {
                      failParentOnFailure: true,
                      parent: {
                        id: job.id!,
                        queue: job.queueQualifiedName,
                      },
                    },
                  });
                  childId = child.id;
                  await job.updateData({
                    step: Step.Second,
                  });
                  step = Step.Second;
                  break;
                }
                case Step.Second: {
                  await job.moveToDelayed(Date.now() + 5000, job.token);
                  await job.updateData({
                    step: Step.Third,
                  });
                  step = Step.Third;
                  throw new DelayedError();
                }
                case Step.Third: {
                  const shouldWait = await job.moveToWaitingChildren(token!);
                  if (!shouldWait) {
                    await job.updateData({
                      step: Step.Finish,
                    });
                    step = Step.Finish;
                    return Step.Finish;
                  } else {
                    throw new WaitingChildrenError();
                  }
                }
                default: {
                  throw new Error('invalid step');
                }
              }
            }
          },
          { connection, prefix },
        );
        await grandchildrenWorker.waitUntilReady();
        await childrenWorker.waitUntilReady();
        await worker.waitUntilReady();

        const failed = new Promise<void>((resolve, reject) => {
          queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
            try {
              expect(jobId).toBe(job.id);
              expect(prev).toBe('active');
              expect(failedReason).toBe(
                `child ${prefix}:${childrenQueueName}:${childId} failed`,
              );
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        });

        const job = await queue.add(
          'test',
          { step: Step.Initial },
          {
            attempts: 3,
            backoff: 1000,
          },
        );

        await failed;
        await flow.close();
        await worker.close();
        await childrenWorker.close();
        await grandchildrenWorker.close();
        await queueEvents.close();
        await removeAllQueueData(new IORedis(redisHost), childrenQueueName);
        await removeAllQueueData(
          new IORedis(redisHost),
          grandchildrenQueueName,
        );
      });
    });

    describe('when parent is in prioritized state', async () => {
      it('should move parent to failed when child is moved to failed', async () => {
        const childrenQueueName = `children-queue-${v4()}`;
        const grandchildrenQueueName = `grandchildren-queue-${v4()}`;

        enum Step {
          Initial,
          Second,
          Third,
          Finish,
        }

        const flow = new FlowProducer({ connection, prefix });

        const grandchildrenWorker = new Worker(
          grandchildrenQueueName,
          async () => {
            await delay(500);
            throw new Error('failed');
          },
          { connection, prefix },
        );
        const childrenWorker = new Worker(childrenQueueName, async () => {}, {
          connection,
          prefix,
        });

        const queueEvents = new QueueEvents(queueName, {
          connection,
          prefix,
        });
        await queueEvents.waitUntilReady();

        let childId;
        const worker = new Worker(
          queueName,
          async (job: Job, token?: string) => {
            let step = job.data.step;
            while (step !== Step.Finish) {
              switch (step) {
                case Step.Initial: {
                  const { job: child } = await flow.add({
                    name: 'child-job',
                    queueName: childrenQueueName,
                    data: {},
                    children: [
                      {
                        name: 'grandchild-job',
                        data: { idx: 0, foo: 'bar' },
                        queueName: grandchildrenQueueName,
                        opts: {
                          failParentOnFailure: true,
                        },
                      },
                    ],
                    opts: {
                      failParentOnFailure: true,
                      parent: {
                        id: job.id!,
                        queue: job.queueQualifiedName,
                      },
                    },
                  });
                  childId = child.id;
                  await job.updateData({
                    step: Step.Second,
                  });
                  step = Step.Second;
                  break;
                }
                case Step.Second: {
                  await queue.rateLimit(2000);
                  await job.updateData({
                    step: Step.Third,
                  });
                  step = Step.Third;
                  throw new RateLimitError();
                }
                case Step.Third: {
                  const shouldWait = await job.moveToWaitingChildren(token!);
                  if (!shouldWait) {
                    await job.updateData({
                      step: Step.Finish,
                    });
                    step = Step.Finish;
                    return Step.Finish;
                  } else {
                    throw new WaitingChildrenError();
                  }
                }
                default: {
                  throw new Error('invalid step');
                }
              }
            }
          },
          { connection, prefix },
        );
        await grandchildrenWorker.waitUntilReady();
        await childrenWorker.waitUntilReady();
        await worker.waitUntilReady();

        const failed = new Promise<void>((resolve, reject) => {
          queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
            try {
              expect(jobId).toBe(job.id);
              expect(prev).toBe('active');
              expect(failedReason).toBe(
                `child ${prefix}:${childrenQueueName}:${childId} failed`,
              );
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        });

        const job = await queue.add(
          'test',
          { step: Step.Initial },
          {
            priority: 10,
          },
        );

        await failed;
        await flow.close();
        await worker.close();
        await childrenWorker.close();
        await grandchildrenWorker.close();
        await queueEvents.close();
        await removeAllQueueData(new IORedis(redisHost), childrenQueueName);
        await removeAllQueueData(
          new IORedis(redisHost),
          grandchildrenQueueName,
        );
      });
    });

    describe('when removeOnFail option is provided', async () => {
      it('should remove parent when child is moved to failed', async () => {
        const name = 'child-job';

        const parentQueueName = `parent-queue-${v4()}`;
        const grandChildrenQueueName = `grand-children-queue-${v4()}`;

        const parentQueue = new Queue(parentQueueName, {
          connection,
          prefix,
        });
        const grandChildrenQueue = new Queue(grandChildrenQueueName, {
          connection,
          prefix,
        });
        const queueEvents = new QueueEvents(parentQueueName, {
          connection,
          prefix,
        });
        await queueEvents.waitUntilReady();

        let grandChildrenProcessor,
          processedGrandChildren = 0;
        const processingChildren = new Promise<void>(resolve => {
          grandChildrenProcessor = async () => {
            processedGrandChildren++;

            if (processedGrandChildren === 2) {
              return resolve();
            }

            await delay(200);

            throw new Error('failed');
          };
        });

        const grandChildrenWorker = new Worker(
          grandChildrenQueueName,
          grandChildrenProcessor,
          { connection, prefix },
        );
        const childrenWorker = new Worker(queueName, async () => {}, {
          connection,
          prefix,
        });
        const parentWorker = new Worker(parentQueueName, async () => {}, {
          connection,
          prefix,
        });

        await grandChildrenWorker.waitUntilReady();
        await childrenWorker.waitUntilReady();
        await parentWorker.waitUntilReady();

        const flow = new FlowProducer({ connection, prefix });
        const tree = await flow.add({
          name: 'parent-job',
          queueName: parentQueueName,
          data: {},
          children: [
            {
              name,
              data: { foo: 'bar' },
              queueName,
            },
            {
              name,
              data: { foo: 'qux' },
              queueName,
              opts: { failParentOnFailure: true, removeOnFail: true },
              children: [
                {
                  name,
                  data: { foo: 'bar' },
                  queueName: grandChildrenQueueName,
                  opts: { failParentOnFailure: true },
                },
                {
                  name,
                  data: { foo: 'baz' },
                  queueName: grandChildrenQueueName,
                },
              ],
            },
          ],
        });

        const failing = new Promise<void>(resolve => {
          queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
            if (jobId === tree.job.id) {
              expect(prev).toBe('active');
              expect(failedReason).toBe(
                `child ${prefix}:${queueName}:${tree.children[1].job.id} failed`,
              );
              resolve();
            }
          });
        });

        expect(tree).toHaveProperty('job');
        expect(tree).toHaveProperty('children');

        const { children, job } = tree;
        const parentState = await job.getState();

        expect(parentState).toEqual('waiting-children');

        await processingChildren;
        await failing;

        const { failed } = await job.getDependenciesCount({ failed: true });

        expect(failed).toBe(1);

        const { children: grandChildren } = children[1];
        const updatedGrandchildJob = await grandChildrenQueue.getJob(
          grandChildren[0].job.id,
        );
        const grandChildState = await updatedGrandchildJob.getState();

        expect(grandChildState).toEqual('failed');
        expect(updatedGrandchildJob.failedReason).toEqual('failed');

        const updatedParentJob = await queue.getJob(children[1].job.id);
        expect(updatedParentJob).toBeUndefined();

        const updatedGrandparentJob = await parentQueue.getJob(job.id);
        const updatedGrandparentState = await updatedGrandparentJob.getState();

        expect(updatedGrandparentState).toEqual('failed');
        expect(updatedGrandparentJob.failedReason).toEqual(
          `child ${prefix}:${queueName}:${children[1].job.id} failed`,
        );

        await parentQueue.close();
        await grandChildrenQueue.close();
        await parentWorker.close();
        await childrenWorker.close();
        await grandChildrenWorker.close();
        await flow.close();
        await queueEvents.close();

        await removeAllQueueData(new IORedis(redisHost), parentQueueName);
        await removeAllQueueData(
          new IORedis(redisHost),
          grandChildrenQueueName,
        );
      });
    });

    describe('when removeDependencyOnFailure is provided', async () => {
      it('moves parent to wait after children fail', async () => {
        const name = 'child-job';

        const parentQueueName = `parent-queue-${v4()}`;
        const grandChildrenQueueName = `grand-children-queue-${v4()}`;

        const parentQueue = new Queue(parentQueueName, {
          connection,
          prefix,
        });
        const grandChildrenQueue = new Queue(grandChildrenQueueName, {
          connection,
          prefix,
        });
        const queueEvents = new QueueEvents(queueName, { connection, prefix });
        await queueEvents.waitUntilReady();

        let grandChildrenProcessor,
          processedGrandChildren = 0;
        const processingChildren = new Promise<void>(resolve => {
          grandChildrenProcessor = async job => {
            processedGrandChildren++;

            if (processedGrandChildren === 2) {
              return resolve();
            }

            if (job.data.foo === 'bar') {
              throw new Error('failed');
            }
          };
        });

        const grandChildrenWorker = new Worker(
          grandChildrenQueueName,
          grandChildrenProcessor,
          { connection, prefix },
        );
        const childrenWorker = new Worker(queueName, async () => {}, {
          connection,
          prefix,
        });
        await grandChildrenWorker.waitUntilReady();
        await childrenWorker.waitUntilReady();

        const flow = new FlowProducer({ connection, prefix });
        const tree = await flow.add({
          name: 'parent-job',
          queueName: parentQueueName,
          data: {},
          children: [
            {
              name,
              data: { foo: 'qux' },
              queueName,
              opts: { removeDependencyOnFailure: true },
              children: [
                {
                  name,
                  data: { foo: 'bar' },
                  queueName: grandChildrenQueueName,
                  opts: { failParentOnFailure: true },
                },
                {
                  name,
                  data: { foo: 'baz' },
                  queueName: grandChildrenQueueName,
                },
              ],
            },
          ],
        });

        const failed = new Promise<void>((resolve, reject) => {
          queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
            try {
              if (jobId === tree!.children![0].job.id) {
                expect(prev).toBe('active');
                expect(failedReason).toBe(
                  `child ${prefix}:${grandChildrenQueueName}:${
                    tree!.children![0].children![0].job.id
                  } failed`,
                );
                resolve();
              } else {
                reject(
                  new Error(
                    `wrong job (${jobId}) failed instead of ${
                      tree!.children![0].job.id
                    }`,
                  ),
                );
              }
            } catch (err) {
              reject(err);
            }
          });
        });

        expect(tree).toHaveProperty('job');
        expect(tree).toHaveProperty('children');

        const { children, job } = tree;
        const parentState = await job.getState();

        expect(parentState).toEqual('waiting-children');

        await processingChildren;
        await failed;

        const { children: grandChildren } = children[0];
        const updatedGrandchildJob = await grandChildrenQueue.getJob(
          grandChildren[0].job.id,
        );
        const grandChildState = await updatedGrandchildJob.getState();
        expect(grandChildState).toEqual('failed');
        expect(updatedGrandchildJob.failedReason).toEqual('failed');

        const updatedParentJob = await queue.getJob(children[0].job.id);
        const updatedParentState = await updatedParentJob.getState();

        expect(updatedParentState).toEqual('failed');
        expect(updatedParentJob.failedReason).toEqual(
          `child ${prefix}:${grandChildrenQueueName}:${updatedGrandchildJob.id} failed`,
        );

        const updatedGrandparentJob = await parentQueue.getJob(job.id);
        const updatedGrandparentState = await updatedGrandparentJob.getState();

        expect(updatedGrandparentState).toEqual('waiting');

        await parentQueue.close();
        await grandChildrenQueue.close();
        await grandChildrenWorker.close();
        await childrenWorker.close();
        await flow.close();
        await queueEvents.close();

        await removeAllQueueData(new IORedis(redisHost), parentQueueName);
        await removeAllQueueData(
          new IORedis(redisHost),
          grandChildrenQueueName,
        );
      }); // TODO: Add { timeout: 8000 } to the it() options
    });

    describe('when ignoreDependencyOnFailure is provided', async () => {
      it('moves parent to wait after children fail', async () => {
        const name = 'child-job';

        const parentQueueName = `parent-queue-${v4()}`;
        const grandChildrenQueueName = `grand-children-queue-${v4()}`;

        const parentQueue = new Queue(parentQueueName, {
          connection,
          prefix,
        });
        const grandChildrenQueue = new Queue(grandChildrenQueueName, {
          connection,
          prefix,
        });
        const queueEvents = new QueueEvents(queueName, { connection, prefix });
        await queueEvents.waitUntilReady();

        let grandChildrenProcessor,
          processedGrandChildren = 0;
        const processingChildren = new Promise<void>(resolve => {
          grandChildrenProcessor = async job => {
            processedGrandChildren++;

            if (processedGrandChildren === 2) {
              return resolve();
            }

            if (job.data.foo === 'bar') {
              throw new Error('failed');
            }
          };
        });

        const grandChildrenWorker = new Worker(
          grandChildrenQueueName,
          grandChildrenProcessor,
          { connection, prefix },
        );
        const childrenWorker = new Worker(queueName, async () => {}, {
          connection,
          prefix,
        });

        await grandChildrenWorker.waitUntilReady();
        await childrenWorker.waitUntilReady();

        const flow = new FlowProducer({ connection, prefix });
        const tree = await flow.add({
          name: 'parent-job',
          queueName: parentQueueName,
          data: {},
          children: [
            {
              name,
              data: { foo: 'qux' },
              queueName,
              opts: { ignoreDependencyOnFailure: true },
              children: [
                {
                  name,
                  data: { foo: 'bar' },
                  queueName: grandChildrenQueueName,
                  opts: { failParentOnFailure: true },
                },
                {
                  name,
                  data: { foo: 'baz' },
                  queueName: grandChildrenQueueName,
                },
              ],
            },
          ],
        });

        const failed = new Promise<void>((resolve, reject) => {
          queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
            try {
              if (jobId === tree!.children![0].job.id) {
                expect(prev).toBe('active');
                expect(failedReason).toBe(
                  `child ${prefix}:${grandChildrenQueueName}:${
                    tree!.children![0].children![0].job.id
                  } failed`,
                );
                resolve();
              } else {
                reject(
                  new Error(
                    `wrong job (${jobId}) failed instead of ${
                      tree!.children![0].job.id
                    }`,
                  ),
                );
              }
            } catch (err) {
              reject(err);
            }
          });
        });

        expect(tree).toHaveProperty('job');
        expect(tree).toHaveProperty('children');

        const { children, job } = tree;
        const parentState = await job.getState();

        expect(parentState).toEqual('waiting-children');

        await processingChildren;
        await failed;

        const { children: grandChildren } = children[0];
        const updatedGrandchildJob = await grandChildrenQueue.getJob(
          grandChildren[0].job.id,
        );
        const grandChildState = await updatedGrandchildJob.getState();
        expect(grandChildState).toEqual('failed');
        expect(updatedGrandchildJob.failedReason).toEqual('failed');

        const updatedParentJob = await queue.getJob(children[0].job.id);
        const updatedParentState = await updatedParentJob.getState();

        expect(updatedParentState).toEqual('failed');
        expect(updatedParentJob.failedReason).toEqual(
          `child ${prefix}:${grandChildrenQueueName}:${updatedGrandchildJob.id} failed`,
        );

        const values = await tree.job.getDependencies();
        expect(Object.keys(values.ignored!).length).toBe(1);

        const updatedGrandparentJob = await parentQueue.getJob(job.id);
        const updatedGrandparentState = await updatedGrandparentJob.getState();

        expect(updatedGrandparentState).toEqual('waiting');

        const ignoredChildrenValues =
          await updatedGrandparentJob.getIgnoredChildrenFailures();

        const failedReason = `child ${prefix}:${grandChildrenQueueName}:${updatedGrandchildJob.id} failed`;
        expect(ignoredChildrenValues).toEqual({
          [`${queue.qualifiedName}:${children[0].job.id}`]: failedReason,
        });

        await parentQueue.close();
        await grandChildrenQueue.close();
        await grandChildrenWorker.close();
        await childrenWorker.close();
        await flow.close();
        await queueEvents.close();

        await removeAllQueueData(new IORedis(redisHost), parentQueueName);
        await removeAllQueueData(
          new IORedis(redisHost),
          grandChildrenQueueName,
        );
      }); // TODO: Add { timeout: 8000 } to the it() options
    });
  });

  describe('when continueParentOnFailure option is provided', async () => {
    it('should start processing parent after a child fails', async () => {
      const name = 'child-job';
      const parentQueueName = `parent-queue-${v4()}`;

      const flow = new FlowProducer({ connection, prefix });
      const flowTree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          {
            name,
            data: { foo: 'bar' },
            queueName,
            opts: { continueParentOnFailure: true },
          },
        ],
      });

      const child = flowTree.children![0].job;

      let parentWorker;
      const processing = new Promise<void>((resolve, reject) => {
        parentWorker = new Worker(
          parentQueueName,
          async job => {
            try {
              const children = await job.getFailedChildrenValues();
              const childKey = `${child.queueQualifiedName}:${child.id}`;

              expect(children[childKey]).toBe('failed');

              const childrenCounts = await job.getDependenciesCount();
              expect(childrenCounts).toEqual({
                processed: 0,
                unprocessed: 0,
                ignored: 1,
                failed: 0,
              });
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          {
            connection,
            prefix,
          },
        );
      });

      const childrenWorker = new Worker(
        queueName,
        async job => {
          throw new Error('failed');
        },
        {
          connection,
          prefix,
        },
      );

      await processing;

      await parentWorker.close();
      await childrenWorker.close();
      await flow.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it('should start processing parent after child fails even with more unprocessed children', async () => {
      const name = 'child-job';
      const parentQueueName = `parent-queue-${v4()}`;

      const flow = new FlowProducer({ connection, prefix });
      const flowTree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          {
            name,
            data: { foo: 'baz' },
            queueName,
          },
          {
            name,
            data: { foo: 'baz' },
            queueName,
          },
          {
            name,
            data: { foo: 'bar' },
            queueName,
            opts: { continueParentOnFailure: true },
          },
          {
            name,
            data: { foo: 'baz' },
            queueName,
          },
          {
            name,
            data: { foo: 'baz' },
            queueName,
          },
        ],
      });

      const childToFail = flowTree.children![2].job;

      let parentWorker;
      const processing = new Promise<void>((resolve, reject) => {
        parentWorker = new Worker(
          parentQueueName,
          async job => {
            try {
              const failedChildren = await job.getFailedChildrenValues();
              const childKey = `${childToFail.queueQualifiedName}:${childToFail.id}`;
              expect(failedChildren[childKey]).toBe('failed');
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          {
            connection,
            prefix,
          },
        );
      });

      let counter = 0;

      let childrenWorker;
      const waitingChildren = new Promise<void>(resolve => {
        childrenWorker = new Worker(
          queueName,
          async job => {
            counter++;
            if (job.id === childToFail.id) {
              throw new Error('failed');
            }
            if (counter === 5) {
              resolve();
            }
          },
          {
            connection,
            prefix,
          },
        );
      });

      await processing;
      await parentWorker.close();
      await waitingChildren;
      await childrenWorker.close();
      await flow.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it('should ignore parent if a child has already failed and another one fails afterwards', async () => {
      const name = 'child-job';
      const parentQueueName = `parent-queue-${v4()}`;

      const flow = new FlowProducer({ connection, prefix });
      const flowTree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          {
            name,
            data: { foo: 'baz' },
            queueName,
          },
          {
            name,
            data: { foo: 'bar' },
            queueName,
            opts: { continueParentOnFailure: true },
          },
          {
            name,
            data: { foo: 'bar' },
            queueName,
            opts: { continueParentOnFailure: true },
          },
          {
            name,
            data: { foo: 'baz' },
            queueName,
          },
          {
            name,
            data: { foo: 'baz' },
            queueName,
          },
        ],
      });

      const childToFail = flowTree.children![1].job;

      let parentWorker;
      const processing = new Promise<void>((resolve, reject) => {
        parentWorker = new Worker(
          parentQueueName,
          async job => {
            try {
              const failedChildren = await job.getFailedChildrenValues();
              const childKey = `${childToFail.queueQualifiedName}:${childToFail.id}`;
              expect(failedChildren[childKey]).toBe('failed');
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          {
            connection,
            prefix,
          },
        );
      });
      let counter = 0;
      let childrenWorker;
      const waitingChildren = new Promise<void>(resolve => {
        childrenWorker = new Worker(
          queueName,
          async job => {
            counter++;
            if (job.id === childToFail.id) {
              throw new Error('failed');
            }
            if (counter === 5) {
              resolve();
            }
          },
          {
            connection,
            prefix,
          },
        );
      });
      await processing;
      await parentWorker.close();
      await waitingChildren;
      await childrenWorker.close();
      await flow.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it('should move the parent to delayed after a child fails', async () => {
      const name = 'child-job';
      const parentQueueName = `parent-queue-${v4()}`;

      const parentQueue = new Queue(parentQueueName, {
        connection,
        prefix,
      });

      const flow = new FlowProducer({ connection, prefix });
      const flowTree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        opts: {
          delay: 1000,
        },
        data: {},
        children: [
          {
            name,
            data: { foo: 'bar' },
            queueName,
            opts: { continueParentOnFailure: true },
          },
        ],
      });

      const child = flowTree.children![0].job;

      let parentWorker;
      const processing = new Promise<void>((resolve, reject) => {
        parentWorker = new Worker(
          parentQueueName,
          async job => {
            try {
              const children = await job.getFailedChildrenValues();
              const childKey = `${child.queueQualifiedName}:${child.id}`;

              expect(children[childKey]).toBe('failed');
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          {
            connection,
            prefix,
          },
        );
      });

      const childrenWorker = new Worker(
        queueName,
        async () => {
          throw new Error('failed');
        },
        {
          connection,
          prefix,
        },
      );

      const waitingFailedChildren = new Promise<void>((resolve, reject) => {
        childrenWorker.on('failed', async () => {
          try {
            const delayedCount = await parentQueue.getDelayedCount();
            expect(delayedCount).toBe(1);

            const waitingCount = await parentQueue.getWaitingCount();
            expect(waitingCount).toBe(0);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await waitingFailedChildren;

      await processing;

      await parentWorker.close();
      await childrenWorker.close();
      await parentQueue.close();
      await flow.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it('should move the parent to prioritized after a child fails', async () => {
      const name = 'child-job';
      const parentQueueName = `parent-queue-${v4()}`;

      const parentQueue = new Queue(parentQueueName, {
        connection,
        prefix,
      });

      const flow = new FlowProducer({ connection, prefix });
      const flowTree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        opts: {
          priority: 42,
        },
        data: {},
        children: [
          {
            name,
            data: { foo: 'bar' },
            queueName,
            opts: { continueParentOnFailure: true },
          },
        ],
      });

      const childrenWorker = new Worker(
        queueName,
        async job => {
          throw new Error('failed');
        },
        {
          connection,
          prefix,
        },
      );

      const waitingFailedChildren = new Promise<void>((resolve, reject) => {
        childrenWorker.on('failed', async () => {
          try {
            const prioritizedCount = await parentQueue.getPrioritizedCount();
            expect(prioritizedCount).toBe(1);

            const delayedCount = await parentQueue.getDelayedCount();
            expect(delayedCount).toBe(0);

            const waitingCount = await parentQueue.getWaitingCount();
            expect(waitingCount).toBe(0);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await waitingFailedChildren;

      const child = flowTree.children![0].job;

      let parentWorker;
      const processing = new Promise<void>((resolve, reject) => {
        parentWorker = new Worker(
          parentQueueName,
          async job => {
            try {
              const children = await job.getFailedChildrenValues();
              const childKey = `${child.queueQualifiedName}:${child.id}`;

              expect(children[childKey]).toBe('failed');
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          {
            connection,
            prefix,
          },
        );
      });

      await processing;

      await parentWorker.close();
      await childrenWorker.close();
      await parentQueue.close();
      await flow.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });
  });

  it('should get paginated processed dependencies keys', async () => {
    const name = 'child-job';
    const values = Array.from(Array(72).keys()).map(() => ({
      bar: 'something',
    }));

    const parentQueueName = `parent-queue-${v4()}`;

    let childrenProcessor,
      parentProcessor,
      processedChildren = 0;
    const processingChildren = new Promise<void>(
      resolve =>
        (childrenProcessor = async (job: Job) => {
          processedChildren++;

          if (processedChildren == values.length) {
            resolve();
          }
          return values[job.data.idx];
        }),
    );

    const processingParent = new Promise<void>((resolve, reject) => [
      (parentProcessor = async (job: Job) => {
        try {
          const { processed, nextProcessedCursor } = await job.getDependencies({
            processed: { cursor: 0, count: 50 },
            unprocessed: { cursor: 0, count: 50 },
          });
          expect(Object.keys(processed).length).greaterThanOrEqual(50);

          const { processed: processed2, nextProcessedCursor: nextCursor2 } =
            await job.getDependencies({
              processed: { cursor: nextProcessedCursor, count: 50 },
            });
          expect(Object.keys(processed2).length).lessThanOrEqual(22);
          expect(nextCursor2).toBe(0);

          resolve();
        } catch (err) {
          console.error(err);
          reject(err);
        }
      }),
    ]);

    const parentWorker = new Worker(parentQueueName, parentProcessor, {
      connection,
      prefix,
    });
    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
      prefix,
    });
    await parentWorker.waitUntilReady();
    await childrenWorker.waitUntilReady();

    const otherValues = Array.from(Array(72).keys()).map(() => ({
      name,
      data: { bar: 'something' },
      queueName,
    }));
    const flow = new FlowProducer({ connection, prefix });
    const tree = await flow.add({
      name: 'parent-job',
      queueName: parentQueueName,
      data: {},
      children: otherValues,
    });

    expect(tree).toHaveProperty('job');
    expect(tree).toHaveProperty('children');

    const { children, job } = tree;
    const parentState = await job.getState();

    expect(parentState).toEqual('waiting-children');
    expect(children).toHaveLength(values.length);

    await processingChildren;
    await childrenWorker.close();

    await processingParent;
    await parentWorker.close();

    await flow.close();

    await removeAllQueueData(new IORedis(redisHost), parentQueueName);
  });

  it('should get a flow tree', async () => {
    const name = 'child-job';

    const topQueueName = `parent-queue-${v4()}`;

    const flow = new FlowProducer({ connection, prefix });
    const originalTree = await flow.add({
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

    const { job: topJob } = originalTree;

    const tree = await flow.getFlow({
      id: topJob.id!,
      queueName: topQueueName,
      prefix,
    });

    expect(tree).toHaveProperty('job');
    expect(tree).toHaveProperty('children');

    const { children, job } = tree;
    const isWaitingChildren = await job.isWaitingChildren();

    expect(isWaitingChildren).toBe(true);
    expect(children).toHaveLength(1);

    expect(children[0].job.id).toBeTruthy();
    expect(children[0].job.data.foo).toEqual('bar');
    expect(children[0].job.queueName).toEqual(queueName);
    expect(children[0].children).toHaveLength(1);

    expect(children[0].children[0].job.id).toBeTruthy();
    expect(children[0].children[0].job.queueName).toEqual(queueName);
    expect(children[0].children[0].job.data.foo).toEqual('baz');

    expect(children[0].children[0].children[0].job.id).toBeTruthy();
    expect(children[0].children[0].children[0].job.data.foo).toEqual('qux');

    await flow.close();

    await removeAllQueueData(new IORedis(redisHost), topQueueName);
  });

  it('should get part of flow tree', async () => {
    const name = 'child-job';

    const topQueueName = `parent-queue-${v4()}`;

    const flow = new FlowProducer({ connection, prefix });
    const originalTree = await flow.add({
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
        {
          name,
          data: { idx: 3, foo: 'bax' },
          queueName,
        },
        {
          name,
          data: { idx: 4, foo: 'baz' },
          queueName,
        },
      ],
    });

    const { job: topJob } = originalTree;

    const tree = await flow.getFlow({
      id: topJob.id!,
      queueName: topQueueName,
      depth: 2,
      maxChildren: 2,
      prefix,
    });

    expect(tree).toHaveProperty('job');
    expect(tree).toHaveProperty('children');

    const { children, job } = tree;
    const isWaitingChildren = await job.isWaitingChildren();

    expect(isWaitingChildren).toBe(true);
    expect(children.length).to.be.greaterThanOrEqual(2);

    expect(children[0].job.id).toBeTruthy();
    expect(children[0].children).toBeUndefined();

    expect(children[1].job.id).toBeTruthy();
    expect(children[1].children).toBeUndefined();

    await flow.close();

    await removeAllQueueData(new IORedis(redisHost), topQueueName);
  });

  describe('when prefix is not provided in getFlow', () => {
    it('should get a flow tree using default prefix from FlowProducer', async () => {
      const name = 'child-job';
      const topQueueName = `parent-queue-${v4()}`;
      const customPrefix = `{${prefix}}`;

      const flow = new FlowProducer({ connection, prefix: customPrefix });
      const originalTree = await flow.add({
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

      const { job: topJob } = originalTree;

      const tree = await flow.getFlow({
        id: topJob.id!,
        queueName: topQueueName,
      });

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;
      const isWaitingChildren = await job.isWaitingChildren();

      expect(isWaitingChildren).toBe(true);
      expect(children).toHaveLength(1);

      expect(children[0].job.id).toBeTruthy();
      expect(children[0].job.data.foo).toEqual('bar');
      expect(children[0].job.queueName).toEqual(queueName);
      expect(children[0].children).toHaveLength(1);

      expect(children[0].children[0].job.id).toBeTruthy();
      expect(children[0].children[0].job.queueName).toEqual(queueName);
      expect(children[0].children[0].job.data.foo).toEqual('baz');

      expect(children[0].children[0].children[0].job.id).toBeTruthy();
      expect(children[0].children[0].children[0].job.data.foo).toEqual('qux');

      await flow.close();

      await removeAllQueueData(new IORedis(redisHost), topQueueName);
    });
  });

  describe('when parent has removeOnComplete as true', () => {
    it('removes processed data', async () => {
      const name = 'child-job';
      const values = [
        { bar: 'something' },
        { baz: 'something' },
        { qux: 'something' },
      ];

      const parentQueueName = `parent-queue-${v4()}`;

      const parentQueue = new Queue(parentQueueName, { connection, prefix });

      let childrenProcessor,
        parentProcessor,
        processedChildren = 0;
      const processingChildren = new Promise<void>(
        resolve =>
          (childrenProcessor = async (job: Job) => {
            processedChildren++;

            if (processedChildren == values.length) {
              resolve();
            }
            return values[job.data.idx];
          }),
      );

      const processingParent = new Promise<void>((resolve, reject) => [
        (parentProcessor = async (job: Job) => {
          try {
            const { processed, nextProcessedCursor } =
              await job.getDependencies({
                processed: {},
              });
            expect(nextProcessedCursor).toBe(0);
            expect(Object.keys(processed!)).toHaveLength(3);

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

      const parentWorker = new Worker(parentQueueName, parentProcessor, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
        prefix,
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const waitOnComplete = new Promise<void>((resolve, reject) => {
        parentWorker.on('completed', async job => {
          try {
            const gotJob = await parentQueue.getJob(job.id);
            const { processed } = await job.getDependencies();

            expect(gotJob).toBe(undefined);
            expect(Object.keys(processed!).length).toBe(0);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        opts: {
          removeOnComplete: true,
        },
        children: [
          { name, data: { idx: 0, foo: 'bar' }, queueName },
          { name, data: { idx: 1, foo: 'baz' }, queueName },
          { name, data: { idx: 2, foo: 'qux' }, queueName },
        ],
      });

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).toEqual('waiting-children');
      expect(children).toHaveLength(3);

      await processingChildren;
      await childrenWorker.close();

      await processingParent;
      await waitOnComplete;
      await parentWorker.close();

      await flow.close();
      await parentQueue.close();

      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });
  });

  it('should process parent when children is an empty array', async () => {
    const parentQueueName = `parent-queue-${v4()}`;

    let parentProcessor;

    const processingParent = new Promise<void>(
      resolve =>
        (parentProcessor = () => {
          resolve();
        }),
    );

    const parentWorker = new Worker(parentQueueName, parentProcessor, {
      connection,
      prefix,
    });

    const flow = new FlowProducer({ connection, prefix });
    const tree = await flow.add({
      name: 'parent-job',
      queueName: parentQueueName,
      data: {},
      children: [],
    });

    expect(tree).toHaveProperty('job');
    expect(tree).not.toHaveProperty('children');

    await processingParent;
    await parentWorker.close();

    await flow.close();

    await removeAllQueueData(new IORedis(redisHost), parentQueueName);
  });

  it('should allow passing custom jobId in options', async () => {
    const name = 'child-job';
    const values = [
      { bar: 'something' },
      { baz: 'something' },
      { qux: 'something' },
    ];

    const parentQueueName = `parent-queue-${v4()}`;

    let childrenProcessor,
      parentProcessor,
      processedChildren = 0;
    const processingChildren = new Promise<void>(
      resolve =>
        (childrenProcessor = async (job: Job) => {
          processedChildren++;

          await delay(50);
          if (processedChildren == values.length) {
            resolve();
          }
          return values[job.data.idx];
        }),
    );

    const processingParent = new Promise<void>(
      (resolve, reject) =>
        (parentProcessor = async (job: Job) => {
          try {
            const { processed, unprocessed } = await job.getDependenciesCount();

            expect(processed).toBe(3);
            expect(unprocessed).toBe(0);

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
    );

    const parentWorker = new Worker(parentQueueName, parentProcessor, {
      connection,
      prefix,
    });
    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
      prefix,
    });

    const flow = new FlowProducer({ connection, prefix });
    const tree = await flow.add({
      name: 'parent-job',
      queueName: parentQueueName,
      data: {},
      opts: { jobId: 'my-parent-job-id' },
      children: [
        { name, data: { idx: 0, foo: 'bar' }, queueName },
        { name, data: { idx: 1, foo: 'baz' }, queueName },
        { name, data: { idx: 2, foo: 'qux' }, queueName },
      ],
    });

    expect(tree).toHaveProperty('job');
    expect(tree).toHaveProperty('children');

    const { children, job } = tree;
    const parentState = await job.getState();

    expect(parentState).toEqual('waiting-children');
    expect(children).toHaveLength(3);

    const { unprocessed } = await job.getDependencies();

    expect(unprocessed.length).toBeGreaterThan(0);
    expect(children[0].job.id).toBeTruthy();
    expect(children[0].job.data.foo).toEqual('bar');
    expect(children[1].job.id).toBeTruthy();
    expect(children[1].job.data.foo).toEqual('baz');
    expect(children[2].job.id).toBeTruthy();
    expect(children[2].job.data.foo).toEqual('qux');

    await processingChildren;
    await childrenWorker.close();

    await processingParent;
    await parentWorker.close();

    await flow.close();

    await removeAllQueueData(new IORedis(redisHost), parentQueueName);
  });

  it('should process a chain of jobs', async () => {
    const name = 'child-job';
    const values = [
      { idx: 0, bar: 'something' },
      { idx: 1, baz: 'something' },
      { idx: 2, qux: 'something' },
    ];

    const topQueueName = `top-queue-${v4()}`;

    let childrenProcessor,
      parentProcessor,
      processedChildren = 0;
    const processingChildren = new Promise<void>((resolve, reject) => [
      (childrenProcessor = async (job: Job) => {
        try {
          const childrenValues = await job.getChildrenValues();
          const waitingChildrenCount = await queue.getWaitingChildrenCount();

          expect(job.data.idx).toEqual(values.length - 1 - processedChildren);
          switch (job.data.idx) {
            case 0:
              {
                const jobKey = queue.toKey(tree.children[0].children[0].job.id);
                expect(childrenValues[jobKey]).to.be.deep.equal(values[1]);
                expect(waitingChildrenCount).to.be.deep.equal(0);
              }
              break;
            case 1:
              {
                const jobKey = queue.toKey(
                  tree.children[0].children[0].children[0].job.id,
                );
                expect(childrenValues[jobKey]).to.be.deep.equal(values[2]);
                expect(waitingChildrenCount).to.be.deep.equal(1);
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
          const { processed } = await job.getDependencies();
          expect(Object.keys(processed)).toHaveLength(1);

          const childrenValues = await job.getChildrenValues();

          const jobKey = queue.toKey(tree.children[0].job.id);
          expect(childrenValues[jobKey]).to.be.deep.equal(values[0]);
          expect(processed[jobKey]).to.be.deep.equal(values[0]);

          resolve();
        } catch (err) {
          console.error(err);
          reject(err);
        }
      }),
    ]);

    const parentWorker = new Worker(topQueueName, parentProcessor, {
      connection,
      prefix,
    });
    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
      prefix,
    });

    const flow = new FlowProducer({ connection, prefix });
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

    expect(tree).toHaveProperty('job');
    expect(tree).toHaveProperty('children');

    const { children, job } = tree;
    const isWaitingChildren = await job.isWaitingChildren();

    expect(isWaitingChildren).toBe(true);
    expect(children).toHaveLength(1);

    expect(children![0].job.id).toBeTruthy();
    expect(children![0].job.data.foo).toEqual('bar');
    expect(children![0].children).toHaveLength(1);

    expect(children![0].children![0].job.id).toBeTruthy();
    expect(children![0].children![0].job.data.foo).toEqual('baz');

    expect(children![0].children![0].children![0].job.id).toBeTruthy();
    expect(children![0].children![0].children![0].job.data.foo).toEqual('qux');

    await processingChildren;
    await childrenWorker.close();

    await processingTop;
    await parentWorker.close();

    await flow.close();

    await removeAllQueueData(new IORedis(redisHost), topQueueName);
  });

  it('should add meta key to both parents and children', async () => {
    const name = 'child-job';
    const topQueueName = `top-queue-${v4()}`;

    const flow = new FlowProducer({ connection, prefix });
    await flow.add({
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

    const client = await flow.client;
    const metaTop = await client.hgetall(`${prefix}:${topQueueName}:meta`);
    expect(metaTop).toMatchObject({ 'opts.maxLenEvents': '10000' });

    const metaChildren = await client.hgetall(`${prefix}:${queueName}:meta`);
    expect(metaChildren).toMatchObject({
      'opts.maxLenEvents': '10000',
    });

    await flow.close();

    await removeAllQueueData(new IORedis(redisHost), topQueueName);
  });

  describe('when parent has delay', () => {
    it('moves process to delayed after children are processed', async () => {
      const name = 'child-job';
      const values = [{ idx: 0, bar: 'something' }];

      const topQueueName = `top-queue-${v4()}`;

      let parentProcessor;
      const childrenWorker = new Worker(
        queueName,
        async (job: Job) => {
          await delay(400);
          return values[job.data.idx];
        },
        {
          autorun: false,
          connection,
          prefix,
        },
      );
      const queueEvents = new QueueEvents(topQueueName, { connection, prefix });
      await queueEvents.waitUntilReady();

      const delayed = new Promise<void>((resolve, reject) => {
        queueEvents.on('delayed', async ({ jobId, delay }) => {
          try {
            const milliseconds = delay - Date.now();
            expect(milliseconds).to.be.lessThanOrEqual(3000);
            expect(milliseconds).toBeGreaterThan(2000);
            resolve();
          } catch (error) {
            console.error(error);
            reject(error);
          }
        });
      });

      const completed = new Promise<void>((resolve, reject) => {
        childrenWorker.on('completed', async function () {
          resolve();
        });
      });

      const processingTop = new Promise<void>((resolve, reject) => [
        (parentProcessor = async (job: Job) => {
          try {
            const { processed } = await job.getDependencies();
            expect(Object.keys(processed)).toHaveLength(1);

            const childrenValues = await job.getChildrenValues();

            const jobKey = queue.toKey(tree.children[0].job.id);
            expect(childrenValues[jobKey]).to.be.deep.equal(values[0]);
            expect(processed[jobKey]).to.be.deep.equal(values[0]);

            resolve();
          } catch (err) {
            console.error(err);
            reject(err);
          }
        }),
      ]);

      const parentWorker = new Worker(topQueueName, parentProcessor, {
        autorun: false,
        connection,
        prefix,
      });

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'root-job',
        queueName: topQueueName,
        data: {},
        children: [
          {
            name,
            data: { idx: 0, foo: 'bar' },
            queueName,
          },
        ],
        opts: {
          delay: 3000,
        },
      });

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;
      const isWaitingChildren = await job.isWaitingChildren();

      expect(isWaitingChildren).toBe(true);
      expect(children).toHaveLength(1);

      expect(children[0].job.id).toBeTruthy();
      expect(children[0].job.data.foo).toEqual('bar');

      childrenWorker.run();
      parentWorker.run();

      await completed;
      await delayed;
      await childrenWorker.close();

      const isDelayed = await job.isDelayed();

      expect(isDelayed).toBe(true);
      await processingTop;
      await parentWorker.close();
      await queueEvents.close();
      await flow.close();

      await removeAllQueueData(new IORedis(redisHost), topQueueName);
    }); // TODO: Add { timeout: 4500 } to the it() options
  });

  describe('when children have delay', () => {
    it('moves children to delayed', async () => {
      const name = 'child-job';
      const values = [{ idx: 0, bar: 'something' }];

      const topQueueName = `top-queue-${v4()}`;

      let parentProcessor;
      const childrenWorker = new Worker(
        queueName,
        async (job: Job) => {
          await delay(500);
          return values[job.data.idx];
        },
        {
          connection,
          prefix,
        },
      );

      const completed = new Promise<void>((resolve, reject) => {
        childrenWorker.on('completed', async function () {
          resolve();
        });
      });

      const processingTop = new Promise<void>((resolve, reject) => [
        (parentProcessor = async (job: Job) => {
          try {
            const { processed } = await job.getDependencies();
            expect(Object.keys(processed)).toHaveLength(1);

            const childrenValues = await job.getChildrenValues();

            const jobKey = queue.toKey(tree.children[0].job.id);
            expect(childrenValues[jobKey]).to.be.deep.equal(values[0]);
            expect(processed[jobKey]).to.be.deep.equal(values[0]);

            resolve();
          } catch (err) {
            console.error(err);
            reject(err);
          }
        }),
      ]);

      const parentWorker = new Worker(topQueueName, parentProcessor, {
        connection,
        prefix,
      });

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'root-job',
        queueName: topQueueName,
        data: {},
        children: [
          {
            name,
            data: { idx: 0, foo: 'bar' },
            queueName,
            opts: {
              delay: 2000,
            },
          },
        ],
      });

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;
      const isWaitingChildren = await job.isWaitingChildren();

      expect(isWaitingChildren).toBe(true);
      expect(children).toHaveLength(1);

      expect(children[0].job.id).toBeTruthy();
      expect(children[0].job.data.foo).toEqual('bar');

      const isDelayed = await children![0].job.isDelayed();

      expect(isDelayed).toBe(true);

      await completed;

      await childrenWorker.close();

      await processingTop;
      await parentWorker.close();
      await flow.close();

      await removeAllQueueData(new IORedis(redisHost), topQueueName);
    });
  });

  it('should not process parent if child fails', async () => {
    const name = 'child-job';

    const parentQueueName = `parent-queue-${v4()}`;

    let childrenProcessor;
    const processingChildren = new Promise<void>(
      resolve =>
        (childrenProcessor = async () => {
          resolve();
          throw new Error('failed job');
        }),
    );

    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
      prefix,
    });

    const flow = new FlowProducer({ connection, prefix });
    const tree = await flow.add({
      name: 'parent-job',
      queueName: parentQueueName,
      data: {},
      children: [{ name, data: { idx: 0, foo: 'bar' }, queueName }],
    });

    expect(tree).toHaveProperty('job');
    expect(tree).toHaveProperty('children');

    const { children } = tree;

    expect(children).toHaveLength(1);

    expect(children![0].job.id).toBeTruthy();
    expect(children![0].job.data.foo).toEqual('bar');

    await processingChildren;
    await childrenWorker.close();

    const parentQueue = new Queue(parentQueueName, { connection, prefix });
    const numJobs = await parentQueue.getWaitingCount();
    expect(numJobs).toBe(0);

    await flow.close();
    await parentQueue.close();
    await removeAllQueueData(new IORedis(redisHost), parentQueueName);
  });

  it('should not process parent until queue is unpaused', async () => {
    const name = 'child-job';
    const parentQueueName = `parent-queue-${v4()}`;

    let childrenProcessor, parentProcessor;
    const processingChildren = new Promise<void>(
      resolve =>
        (childrenProcessor = async () => {
          resolve();
        }),
    );

    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
      prefix,
    });

    const processingParent = new Promise<void>(
      resolve =>
        (parentProcessor = async () => {
          resolve();
        }),
    );

    const parentWorker = new Worker(parentQueueName, parentProcessor, {
      connection,
      prefix,
    });

    const parentQueue = new Queue(parentQueueName, { connection, prefix });
    await parentQueue.pause();

    const flow = new FlowProducer({ connection, prefix });
    const tree = await flow.add({
      name: 'parent-job',
      queueName: parentQueueName,
      data: {},
      children: [{ name, data: { idx: 0, foo: 'bar' }, queueName }],
    });

    expect(tree).toHaveProperty('job');
    expect(tree).toHaveProperty('children');

    const { children } = tree;

    expect(children).toHaveLength(1);

    expect(children![0].job.id).toBeTruthy();
    expect(children![0].job.data.foo).toEqual('bar');

    await processingChildren;
    await childrenWorker.close();

    await delay(500);

    let numJobs = await parentQueue.getWaitingCount();
    expect(numJobs).toBe(1);

    await parentQueue.resume();

    await processingParent;
    await parentWorker.close();

    numJobs = await parentQueue.getWaitingCount();
    expect(numJobs).toBe(0);

    await flow.close();
    await parentQueue.close();
    await removeAllQueueData(new IORedis(redisHost), parentQueueName);
  });

  describe('.addBulk', () => {
    it('should allow parent opts on the root job', async () => {
      const name = 'child-job';
      const values = [{ bar: 'something' }, { baz: 'something' }];

      const parentQueueName = `parent-queue-${v4()}`;
      const grandparentQueueName = `grandparent-queue-${v4()}`;
      const grandparentQueue = new Queue(grandparentQueueName, {
        connection,
        prefix,
      });
      const grandparentJob = await grandparentQueue.add('grandparent', {
        foo: 'bar',
      });

      let childrenProcessor,
        parentProcessor,
        processedChildren = 0;
      const processingChildren = new Promise<void>(
        resolve =>
          (childrenProcessor = async (job: Job) => {
            processedChildren++;

            if (processedChildren == values.length) {
              resolve();
            }
            return values[job.data.idx];
          }),
      );

      const processingParent = new Promise<void>((resolve, reject) => [
        (parentProcessor = async (job: Job) => {
          try {
            const { processed, nextProcessedCursor } =
              await job.getDependencies({
                processed: {},
              });
            expect(nextProcessedCursor).toBe(0);
            expect(Object.keys(processed)).toHaveLength(2);

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

      const parentWorker = new Worker(parentQueueName, parentProcessor, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
        prefix,
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const flow = new FlowProducer({ connection, prefix });
      const [tree] = await flow.addBulk([
        {
          name: 'parent-job',
          queueName: parentQueueName,
          data: {},
          children: [
            { name, data: { idx: 0, foo: 'bar' }, queueName },
            { name, data: { idx: 1, foo: 'baz' }, queueName },
          ],
          opts: {
            parent: {
              id: grandparentJob.id!,
              queue: `${prefix}:${grandparentQueueName}`,
            },
          },
        },
      ]);

      expect(tree).toHaveProperty('job');
      expect(tree).toHaveProperty('children');

      const { children, job } = tree;

      expect(job.parentKey).toBe(
        `${prefix}:${grandparentQueueName}:${grandparentJob.id}`,
      );
      const parentState = await job.getState();

      expect(parentState).toEqual('waiting-children');
      expect(children).toHaveLength(2);

      await processingChildren;
      await childrenWorker.close();

      await processingParent;
      await parentWorker.close();

      await flow.close();

      await grandparentQueue.close();
      await removeAllQueueData(new IORedis(redisHost), grandparentQueueName);
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it('should process jobs', async () => {
      const name = 'child-job';
      const values = [
        { idx: 0, bar: 'something' },
        { idx: 1, baz: 'something' },
      ];

      const rootQueueName = 'root-queue';

      let childrenProcessor,
        rootProcessor,
        processedChildren = 0,
        processedRoot = 0;
      const processingChildren = new Promise<void>((resolve, reject) => [
        (childrenProcessor = async (job: Job) => {
          try {
            processedChildren++;
            if (processedChildren === values.length) {
              resolve();
            }
            return values[job.data.idx];
          } catch (err) {
            reject(err);
          }
        }),
      ]);

      const processingRoot = new Promise<void>((resolve, reject) => [
        (rootProcessor = async (job: Job) => {
          try {
            const childrenValues = await job.getChildrenValues();
            const index = job.name === 'root-job-1' ? 0 : 1;
            const jobKey = queue.toKey(trees[index].children[0].job.id);
            expect(childrenValues[jobKey]).to.be.deep.equal(values[index]);

            processedRoot++;
            if (processedRoot === 2) {
              resolve();
            }
            return processedRoot;
          } catch (err) {
            console.error(err);
            reject(err);
          }
        }),
      ]);

      const flow = new FlowProducer({ connection, prefix });
      const trees = await flow.addBulk([
        {
          name: 'root-job-1',
          queueName: rootQueueName,
          data: {},
          children: [
            {
              name,
              data: { idx: 0, foo: 'bar' },
              queueName,
            },
          ],
        },
        {
          name: 'root-job-2',
          queueName: rootQueueName,
          data: {},
          children: [
            {
              name,
              data: { idx: 1, foo: 'baz' },
              queueName,
            },
          ],
        },
      ]);

      expect(trees).toHaveLength(2);

      expect(trees[0]).toHaveProperty('job');
      expect(trees[0]).toHaveProperty('children');

      expect(trees[1]).toHaveProperty('job');
      expect(trees[1]).toHaveProperty('children');

      const firstJob = trees[0];
      const isFirstJobWaitingChildren = await firstJob.job.isWaitingChildren();
      expect(isFirstJobWaitingChildren).toBe(true);
      expect(firstJob.children).toHaveLength(1);

      expect(firstJob.children[0].job.id).toBeTruthy();
      expect(firstJob.children[0].job.data.foo).toEqual('bar');
      expect(firstJob.children).toHaveLength(1);

      const secondJob = trees[1];
      const isSecondJobWaitingChildren =
        await secondJob.job.isWaitingChildren();
      expect(isSecondJobWaitingChildren).toBe(true);
      expect(secondJob.children).toHaveLength(1);

      expect(secondJob.children[0].job.id).toBeTruthy();
      expect(secondJob.children[0].job.data.foo).toEqual('baz');

      const parentWorker = new Worker(rootQueueName, rootProcessor, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
        prefix,
      });

      await processingChildren;
      await childrenWorker.close();

      await processingRoot;
      await parentWorker.close();

      await flow.close();

      await removeAllQueueData(new IORedis(redisHost), rootQueueName);
    });
  });

  describe('.removeUnprocessedChildren', async () => {
    it('should remove unprocessed children', async () => {
      const name = 'child-job';
      const values = [{ idx: 0, bar: 'something' }];

      const parentQueueName = `parent-queue-${v4()}`;
      const flow = new FlowProducer({ connection, prefix });

      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          { name, data: { idx: 0, foo: 'bar' }, queueName },
          {
            name,
            data: { idx: 1, foo: 'bar' },
            queueName,
            opts: { priority: 1 },
          },
          {
            name,
            data: { idx: 2, foo: 'bar' },
            queueName,
            opts: { delay: 1000 },
          },
          { name, data: { idx: 3, foo: 'bar' }, queueName },
          { name, data: { idx: 4, foo: 'bar' }, queueName },
          {
            name,
            data: { idx: 0, foo: 'baz' },
            queueName,
            children: [{ name, data: { idx: 0, foo: 'qux' }, queueName }],
          },
        ],
      });

      // We will process one job, we will fail the second job and then on the third job we will try
      // to remove all children.
      // so that we can test that it does not remove the active nor the completed and failed jobs.

      let counter = 0;
      const processed: string[] = [];
      let worker;

      const processing = new Promise<void>((resolve, reject) => {
        worker = new Worker(
          queueName,
          async (job: Job) => {
            counter++;
            if (counter === 1) {
              processed.push(job.id!);
              return values[job.data.idx];
            } else if (counter === 2) {
              processed.push(job.id!);
              throw new Error('failed job');
            } else if (counter === 3) {
              try {
                await tree.job.removeUnprocessedChildren();
                const children = tree.children!;
                processed.push(job.id!);

                for (let i = 0; i < children.length; i++) {
                  const child = children[i]!;
                  const childJob = await Job.fromId(queue, child.job.id!);

                  if (!processed.includes(child.job.id!)) {
                    expect(childJob).toBeUndefined();
                  } else {
                    expect(childJob).toBeTruthy();
                    expect(childJob!.parent).toEqual({
                      id: tree.job.id,
                      queueKey: `${prefix}:${parentQueueName}`,
                    });
                  }
                }
                resolve();
              } catch (err) {
                reject(err);
              }
            }
          },
          {
            connection,
            prefix,
          },
        );
      });
      try {
        await processing;
      } finally {
        await worker.close();
        await flow.close();
        await removeAllQueueData(new IORedis(redisHost), parentQueueName);
      }
    });

    it('should not remove completed children', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const name = 'child-job';
      const numChildren = 6;

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          { name, data: { idx: 0, foo: 'bar' }, queueName },
          { name, data: { idx: 1, foo: 'bar' }, queueName },
          { name, data: { idx: 2, foo: 'bar' }, queueName },
          { name, data: { idx: 3, foo: 'bar' }, queueName },
          {
            name,
            data: { idx: 0, foo: 'baz' },
            queueName,
            children: [{ name, data: { idx: 0, foo: 'qux' }, queueName }],
          },
        ],
      });

      const parentWorker = new Worker(parentQueueName, async job => {}, {
        connection,
        prefix,
      });
      const childrenWorker = new Worker(
        queueName,
        async job => {
          await delay(10);
        },
        {
          connection,
          prefix,
        },
      );
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const completing = new Promise(resolve => {
        parentWorker.on('completed', resolve);
      });

      await completing;

      const childrenJobs = await queue.getJobCountByTypes('completed');
      expect(childrenJobs).toBe(numChildren);

      // We try to remove now, but no children should be removed as they are all completed
      await tree.job.removeUnprocessedChildren();

      const jobs = await queue.getJobCountByTypes('completed');
      expect(jobs).toBe(numChildren);

      await flow.close();
      await childrenWorker.close();
      await parentWorker.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });
  });

  describe('.remove', () => {
    it('should remove all children when removing a parent', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const name = 'child-job';

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          { name, data: { idx: 0, foo: 'bar' }, queueName },
          {
            name,
            data: { idx: 0, foo: 'baz' },
            queueName,
            children: [{ name, data: { idx: 0, foo: 'qux' }, queueName }],
          },
        ],
      });

      expect(await tree.job.getState()).toBe('waiting-children');

      expect(await tree.children[0].job.getState()).toBe('waiting');
      expect(await tree.children[1].job.getState()).toBe('waiting-children');

      expect(await tree.children[1].children[0].job.getState()).toBe('waiting');

      for (let i = 0; i < tree.children.length; i++) {
        const child = tree.children[i];
        const childJob = await Job.fromId(queue, child.job.id);
        expect(childJob.parent).toEqual({
          id: tree.job.id,
          queueKey: `${prefix}:${parentQueueName}`,
        });
      }

      await tree.job.remove();

      const parentQueue = new Queue(parentQueueName, { connection, prefix });
      const parentJob = await Job.fromId(parentQueue, tree.job.id);
      expect(parentJob).toBeUndefined();

      for (let i = 0; i < tree.children.length; i++) {
        const child = tree.children[i];
        const childJob = await Job.fromId(queue, child.job.id);
        expect(childJob).toBeUndefined();
      }

      expect(await tree.children[0].job.getState()).toBe('unknown');
      expect(await tree.children[1].job.getState()).toBe('unknown');
      expect(await tree.job.getState()).toBe('unknown');

      const jobs = await queue.getJobCountByTypes('waiting');
      expect(jobs).toBe(0);

      await flow.close();
      await parentQueue.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    describe('when removeChildren option is provided as false', () => {
      it('does not remove any children when removing a parent', async () => {
        const parentQueueName = `parent-queue-${v4()}`;
        const name = 'child-job';

        const flow = new FlowProducer({ connection, prefix });
        const tree = await flow.add({
          name: 'parent-job',
          queueName: parentQueueName,
          data: {},
          children: [
            { name, data: { idx: 0, foo: 'bar' }, queueName },
            {
              name,
              data: { idx: 0, foo: 'baz' },
              queueName,
              children: [{ name, data: { idx: 0, foo: 'qux' }, queueName }],
            },
          ],
        });

        expect(await tree.job.getState()).toBe('waiting-children');

        expect(await tree.children[0].job.getState()).toBe('waiting');
        expect(await tree.children[1].job.getState()).toBe('waiting-children');

        expect(await tree.children[1].children[0].job.getState()).toBe(
          'waiting',
        );

        for (let i = 0; i < tree.children.length; i++) {
          const child = tree.children[i];
          const childJob = await Job.fromId(queue, child.job.id);
          expect(childJob.parent).toEqual({
            id: tree.job.id,
            queueKey: `${prefix}:${parentQueueName}`,
          });
        }

        await tree.job.remove({ removeChildren: false });

        const parentQueue = new Queue(parentQueueName, { connection, prefix });
        const parentJob = await Job.fromId(parentQueue, tree.job.id);
        expect(parentJob).toBeUndefined();

        for (let i = 0; i < tree.children.length; i++) {
          const child = tree.children[i];
          const childJob = await Job.fromId(queue, child.job.id);
          expect(childJob).toBeDefined();
        }

        expect(await tree.children[0].job.getState()).toBe('waiting');
        expect(await tree.children[1].job.getState()).toBe('waiting-children');
        expect(await tree.job.getState()).toBe('unknown');

        const jobs = await queue.getJobCountByTypes('waiting');
        expect(jobs).toBe(2);

        await flow.close();
        await parentQueue.close();
        await removeAllQueueData(new IORedis(redisHost), parentQueueName);
      });
    });

    describe('when there are processed children', () => {
      it('removes all children when removing a parent', async () => {
        const parentQueueName = `parent-queue-${v4()}`;
        const name = 'child-job';

        const flow = new FlowProducer({ connection, prefix });
        const tree = await flow.add({
          name: 'parent-job',
          queueName: parentQueueName,
          data: {},
          children: [
            { name, data: { idx: 0, foo: 'bar' }, queueName },
            {
              name,
              data: { idx: 0, foo: 'baz' },
              queueName,
              children: [{ name, data: { idx: 0, foo: 'qux' }, queueName }],
            },
          ],
        });

        expect(await tree.job.getState()).toBe('waiting-children');

        expect(await tree.children[0].job.getState()).toBe('waiting');
        expect(await tree.children[1].job.getState()).toBe('waiting-children');

        expect(await tree.children[1].children[0].job.getState()).toBe(
          'waiting',
        );

        for (let i = 0; i < tree.children.length; i++) {
          const child = tree.children[i];
          const childJob = await Job.fromId(queue, child.job.id);
          expect(childJob.parent).toEqual({
            id: tree.job.id,
            queueKey: `${prefix}:${parentQueueName}`,
          });
        }

        const parentWorker = new Worker(parentQueueName, async () => {}, {
          connection,
          prefix,
        });
        const childrenWorker = new Worker(
          queueName,
          async () => {
            await delay(10);
          },
          {
            connection,
            prefix,
          },
        );
        await parentWorker.waitUntilReady();
        await childrenWorker.waitUntilReady();

        const completing = new Promise(resolve => {
          parentWorker.on('completed', resolve);
        });

        await completing;
        await tree.job.remove();

        const parentQueue = new Queue(parentQueueName, { connection, prefix });
        const parentJob = await Job.fromId(parentQueue, tree.job.id);
        expect(parentJob).toBeUndefined();

        for (let i = 0; i < tree.children.length; i++) {
          const child = tree.children[i];
          const childJob = await Job.fromId(queue, child.job.id);
          expect(childJob).toBeUndefined();
        }

        const jobs = await queue.getJobCountByTypes('completed');
        expect(jobs).toBe(0);

        expect(await tree.children[0].job.getState()).toBe('unknown');
        expect(await tree.children[1].job.getState()).toBe('unknown');
        expect(await tree.job.getState()).toBe('unknown');

        await flow.close();
        await childrenWorker.close();
        await parentWorker.close();
        await parentQueue.close();
        await removeAllQueueData(new IORedis(redisHost), parentQueueName);
      });

      describe('when there is a grand parent', () => {
        it('removes all children when removing a parent, but not grandparent', async () => {
          const parentQueueName = `parent-queue-${v4()}`;
          const grandparentQueueName = `grandparent-queue-${v4()}`;
          const name = 'child-job';

          const flow = new FlowProducer({ connection, prefix });
          const tree = await flow.add({
            name: 'grandparent-job',
            queueName: grandparentQueueName,
            data: {},
            children: [
              {
                name: 'parent-job',
                queueName: parentQueueName,
                data: {},
                children: [
                  { name, data: { idx: 0, foo: 'bar' }, queueName },
                  {
                    name,
                    data: { idx: 0, foo: 'baz' },
                    queueName,
                    children: [
                      { name, data: { idx: 0, foo: 'qux' }, queueName },
                    ],
                  },
                ],
              },
            ],
          });

          expect(await tree.job.getState()).toBe('waiting-children');
          expect(await tree.children![0].job.getState()).toBe(
            'waiting-children',
          );

          expect(await tree.children![0].children![0].job.getState()).toBe(
            'waiting',
          );
          expect(await tree.children![0].children![1].job.getState()).toBe(
            'waiting-children',
          );

          expect(
            await tree.children![0].children![1].children![0].job.getState(),
          ).toBe('waiting');

          for (let i = 0; i < tree.children![0].children!.length; i++) {
            const child = tree.children![0].children![i];
            const childJob = await Job.fromId(queue, child.job.id);
            expect(childJob.parent).toEqual({
              id: tree.children![0].job.id,
              queueKey: `${prefix}:${parentQueueName}`,
            });
          }

          const parentWorker = new Worker(parentQueueName, async () => {}, {
            connection,
            prefix,
          });
          const childrenWorker = new Worker(
            queueName,
            async () => {
              await delay(10);
            },
            {
              connection,
              prefix,
            },
          );
          await parentWorker.waitUntilReady();
          await childrenWorker.waitUntilReady();

          const completing = new Promise(resolve => {
            parentWorker.on('completed', resolve);
          });

          await completing;
          await tree.children![0].job.remove();

          const parentQueue = new Queue(parentQueueName, {
            connection,
            prefix,
          });
          const parentJob = await Job.fromId(parentQueue, tree.job.id);
          expect(parentJob).toBeUndefined();

          for (let i = 0; i < tree.children![0].children!.length; i++) {
            const child = tree.children![0].children![i];
            const childJob = await Job.fromId(queue, child.job.id);
            expect(childJob).toBeUndefined();
          }

          const jobs = await queue.getJobCountByTypes('completed');
          expect(jobs).toBe(0);

          expect(await tree.children![0].children![0].job.getState()).toBe(
            'unknown',
          );
          expect(await tree.children![0].children![1].job.getState()).toBe(
            'unknown',
          );
          expect(await tree.children![0].job.getState()).toBe('unknown');
          expect(await tree.job.getState()).toBe('waiting');

          await flow.close();
          await childrenWorker.close();
          await parentWorker.close();
          await parentQueue.close();
          await removeAllQueueData(
            new IORedis(redisHost),
            grandparentQueueName,
          );
          await removeAllQueueData(new IORedis(redisHost), parentQueueName);
        });
      });
    });

    describe('when there are unsuccessful children', () => {
      it('removes all children when removing a parent', async () => {
        const parentQueueName = `parent-queue-${v4()}`;
        const name = 'child-job';

        const flow = new FlowProducer({ connection, prefix });
        const tree = await flow.add({
          name: 'parent-job',
          queueName: parentQueueName,
          data: {},
          children: [
            { name, data: { idx: 0, foo: 'bar' }, queueName },
            {
              name,
              data: { idx: 0, foo: 'baz' },
              queueName,
              children: [
                {
                  name,
                  data: { idx: 0, foo: 'qux' },
                  queueName,
                  opts: { failParentOnFailure: true },
                },
              ],
              opts: { failParentOnFailure: true },
            },
          ],
        });

        expect(await tree.job.getState()).toBe('waiting-children');

        expect(await tree.children[0].job.getState()).toBe('waiting');
        expect(await tree.children[1].job.getState()).toBe('waiting-children');

        expect(await tree.children[1].children[0].job.getState()).toBe(
          'waiting',
        );

        for (let i = 0; i < tree.children.length; i++) {
          const child = tree.children[i];
          const childJob = await Job.fromId(queue, child.job.id);
          expect(childJob.parent).toMatchObject({
            id: tree.job.id,
            queueKey: `${prefix}:${parentQueueName}`,
          });
        }

        const parentQueueEvents = new QueueEvents(parentQueueName, {
          connection,
          prefix,
        });
        await parentQueueEvents.waitUntilReady();

        const childrenWorker = new Worker(
          queueName,
          async () => {
            throw new Error('failure');
          },
          {
            autorun: false,
            connection,
            prefix,
          },
        );
        const parentWorker = new Worker(parentQueueName, async () => {}, {
          connection,
          prefix,
        });
        await childrenWorker.waitUntilReady();
        await parentWorker.waitUntilReady();

        const failing = new Promise<void>(resolve => {
          parentQueueEvents.on('failed', ({ jobId }) => {
            if (jobId === tree.job.id) {
              resolve();
            }
          });
        });

        childrenWorker.run();
        await failing;
        await tree.job.remove();

        const parentQueue = new Queue(parentQueueName, { connection, prefix });
        const parentJob = await Job.fromId(parentQueue, tree.job.id);
        expect(parentJob).toBeUndefined();

        for (let i = 0; i < tree.children.length; i++) {
          const child = tree.children[i];
          const childJob = await Job.fromId(queue, child.job.id);
          expect(childJob).toBeUndefined();
        }

        const jobs = await queue.getJobCountByTypes('failed');
        expect(jobs).toBe(0);

        expect(await tree.children[0].job.getState()).toBe('unknown');
        expect(await tree.children[1].job.getState()).toBe('unknown');
        expect(await tree.job.getState()).toBe('unknown');

        await flow.close();
        await parentQueueEvents.close();
        await childrenWorker.close();
        await parentWorker.close();
        await parentQueue.close();
        await removeAllQueueData(new IORedis(redisHost), parentQueueName);
      });
    });

    it('should not remove anything if there is a locked job in the tree', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const name = 'child-job';

      const worker = new Worker(queueName, null, { connection, prefix });

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          { name, data: { idx: 0, foo: 'bar' }, queueName },
          { name, data: { idx: 0, foo: 'baz' }, queueName },
        ],
      });

      // Get job so that it gets locked.
      const nextJob = await worker.getNextJob('1234');

      expect(nextJob).toBeDefined();
      expect(await (nextJob as Job).getState()).toBe('active');

      await expect(tree.job.remove()).rejects.toThrow(
        `Job ${tree.job.id} could not be removed because it is locked by another worker`,
      );

      expect(await tree.job.getState()).toBe('waiting-children');
      expect(await tree.children[0].job.getState()).toBe('active');
      expect(await tree.children[1].job.getState()).toBe('waiting');

      await flow.close();
      await worker.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it('should remove from parent dependencies and move parent to wait', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const name = 'child-job';

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'root-job',
        queueName: parentQueueName,
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

      // We remove from deepest child and upwards to check if jobs
      // are moved to the wait status correctly
      const parentQueue = new Queue(parentQueueName, { connection, prefix });

      async function removeChildJob(node: JobNode) {
        expect(await node.job.getState()).toBe('waiting-children');

        await node.children[0].job.remove();

        expect(await node.job.getState()).toBe('waiting');
      }

      await removeChildJob(tree.children[0].children[0]);
      await removeChildJob(tree.children[0]);
      await removeChildJob(tree);

      await flow.close();
      await parentQueue.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it(`should only move parent to wait when all children have been removed`, async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const name = 'child-job';

      const flow = new FlowProducer({ connection, prefix });
      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          { name, data: { idx: 0, foo: 'bar' }, queueName },
          { name, data: { idx: 0, foo: 'baz' }, queueName },
        ],
      });

      expect(await tree.job.getState()).toBe('waiting-children');
      expect(await tree.children![0].job.getState()).toBe('waiting');

      await tree.children![0].job.remove();

      expect(await tree.children![0].job.getState()).toBe('unknown');
      expect(await tree.job.getState()).toBe('waiting-children');

      await tree.children![1].job.remove();
      expect(await tree.children![1].job.getState()).toBe('unknown');
      expect(await tree.job.getState()).toBe('waiting');

      await flow.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });
  });

  describe('.retry', () => {
    describe('when retrying a failed child', () => {
      it('should update parent dependencies reference', async () => {
        const parentQueueName = `parent-queue-${v4()}`;
        const name = 'child-job';

        const flow = new FlowProducer({ connection, prefix });
        await flow.add({
          name: 'parent-job',
          queueName: parentQueueName,
          data: {},
          children: [{ name, data: { idx: 0, foo: 'bar' }, queueName }],
        });

        const parentWorker = new Worker(parentQueueName, async job => {}, {
          connection,
          prefix,
        });
        const childrenWorker = new Worker(
          queueName,
          async job => {
            await delay(10);
            if (job.data.idx === 0) {
              await job.updateData({ idx: 1, foo: 'baz' });
              throw new Error('error');
            }
          },
          {
            connection,
            prefix,
          },
        );
        await parentWorker.waitUntilReady();
        await childrenWorker.waitUntilReady();

        const failing = new Promise<void>(resolve => {
          childrenWorker.on('failed', async job => {
            await job?.retry('failed');
            resolve();
          });
        });

        await failing;

        const completing = new Promise(resolve => {
          parentWorker.on('completed', resolve);
        });

        await completing;

        const childrenJobs = await queue.getJobCountByTypes('completed');
        expect(childrenJobs).toBe(1);

        await flow.close();
        await childrenWorker.close();
        await parentWorker.close();
        await removeAllQueueData(new IORedis(redisHost), parentQueueName);
      });
    });

    describe('when retrying a completed child', () => {
      it('should update parent dependencies reference', async () => {
        const parentQueueName = `parent-queue-${v4()}`;
        const name = 'child-job';

        const flow = new FlowProducer({ connection, prefix });
        await flow.add({
          name: 'parent-job',
          queueName: parentQueueName,
          data: {},
          children: [
            { name, data: { idx: 0 }, queueName },
            { name, data: { idx: 1 }, queueName },
          ],
        });

        const parentWorker = new Worker(parentQueueName, async job => {}, {
          connection,
          prefix,
        });
        const childrenWorker = new Worker(
          queueName,
          async job => {
            await job.updateData({ idx: job.data.idx + 2 });
            await delay(200);
          },
          {
            connection,
            prefix,
          },
        );
        await parentWorker.waitUntilReady();
        await childrenWorker.waitUntilReady();

        const childCompletion = new Promise<void>(resolve => {
          childrenWorker.on('completed', async job => {
            if (job?.data.idx === 2) {
              await job?.retry('completed');
              resolve();
            }
          });
        });

        await childCompletion;

        const completing = new Promise(resolve => {
          parentWorker.on('completed', resolve);
        });

        await completing;

        const childrenJobs = await queue.getJobCountByTypes('completed');
        expect(childrenJobs).toBe(2);

        await flow.close();
        await childrenWorker.close();
        await parentWorker.close();
        await removeAllQueueData(new IORedis(redisHost), parentQueueName);
      });
    });
  });

  describe('when root parent job has deduplication option', () => {
    it('should deduplicate root parent job when added again with same deduplication id', async () => {
      const flow = new FlowProducer({ connection, prefix });
      const queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();

      const dedupId = 'dedup-parent-id';

      const deduplicatedPromise = new Promise<void>((resolve, reject) => {
        queueEvents.once(
          'deduplicated',
          async ({ jobId, deduplicationId, deduplicatedJobId }) => {
            try {
              expect(jobId).toBe('parent1');
              expect(deduplicationId).toBe(dedupId);
              expect(deduplicatedJobId).toBe('parent2');
              resolve();
            } catch (error) {
              reject(error);
            }
          },
        );
      });

      await flow.add({
        name: 'parent',
        data: { order: 1 },
        queueName,
        opts: {
          jobId: 'parent1',
          deduplication: { id: dedupId },
        },
        children: [
          {
            queueName,
            name: 'child1',
            data: { value: 'first' },
          },
        ],
      });

      // Add second flow with same deduplication id
      await flow.add({
        name: 'parent',
        data: { order: 2 },
        queueName,
        opts: {
          jobId: 'parent2',
          deduplication: { id: dedupId },
        },
        children: [
          {
            queueName,
            name: 'child2',
            data: { value: 'second' },
          },
        ],
      });

      await deduplicatedPromise;

      // Verify only first parent exists
      const parent1 = await queue.getJob('parent1');
      expect(parent1).toBeDefined();
      expect(parent1!.data.order).toBe(1);

      const parent2 = await queue.getJob('parent2');
      expect(parent2).toBeUndefined();

      // Verify only first child exists (second child should not be created)
      const waitingJobs = await queue.getJobs(['waiting', 'waiting-children']);
      const childJobs = waitingJobs.filter(job => job.name.startsWith('child'));
      expect(childJobs.length).toBe(1);
      expect(childJobs[0].name).toBe('child1');

      await queueEvents.close();
      await flow.close();
    });
  });
});
