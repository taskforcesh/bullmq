import { after, last } from 'lodash';
import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { beforeEach, describe, it } from 'mocha';
import { v4 } from 'uuid';
import {
  Job,
  Queue,
  QueueEvents,
  Worker,
  FlowProducer,
  JobNode,
} from '../src/classes';
import { removeAllQueueData, delay } from '../src/utils';

describe('flows', () => {
  let queue: Queue;
  let queueName: string;
  const connection = { host: 'localhost' };

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection });
  });

  afterEach(async function () {
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
          expect(nextProcessedCursor).to.be.equal(0);
          expect(Object.keys(processed)).to.have.length(3);

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
    });
    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
    });
    await parentWorker.waitUntilReady();
    await childrenWorker.waitUntilReady();

    const flow = new FlowProducer({ connection });
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
    expect(children[0].job.parent).to.deep.equal({
      id: job.id,
      queueKey: `bull:${parentQueueName}`,
    });
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

  it('should allow parent opts on the root job', async () => {
    const name = 'child-job';
    const values = [{ bar: 'something' }, { baz: 'something' }];

    const parentQueueName = `parent-queue-${v4()}`;
    const grandparentQueueName = `grandparent-queue-${v4()}`;
    const grandparentQueue = new Queue(grandparentQueueName, { connection });
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
          expect(nextProcessedCursor).to.be.equal(0);
          expect(Object.keys(processed)).to.have.length(2);

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
    });
    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
    });
    await parentWorker.waitUntilReady();
    await childrenWorker.waitUntilReady();

    const flow = new FlowProducer({ connection });
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
          id: grandparentJob.id,
          queue: `bull:${grandparentQueueName}`,
        },
      },
    });

    expect(tree).to.have.property('job');
    expect(tree).to.have.property('children');

    const { children, job } = tree;

    expect(job.parentKey).to.be.equal(
      `bull:${grandparentQueueName}:${grandparentJob.id}`,
    );
    const parentState = await job.getState();

    expect(parentState).to.be.eql('waiting-children');
    expect(children).to.have.length(2);

    await processingChildren;
    await childrenWorker.close();

    await processingParent;
    await parentWorker.close();

    await flow.close();

    await grandparentQueue.close();
    await removeAllQueueData(new IORedis(), grandparentQueueName);
    await removeAllQueueData(new IORedis(), parentQueueName);
  });

  describe('when chaining flows at runtime using step jobs', () => {
    it('should wait children as one step of the parent job', async function () {
      this.timeout(8000);
      const childrenQueueName = `children-queue-${v4()}`;
      const grandchildrenQueueName = `grandchildren-queue-${v4()}`;

      enum Step {
        Initial,
        Second,
        Third,
        Finish,
      }

      const flow = new FlowProducer({ connection });

      const childrenWorker = new Worker(
        childrenQueueName,
        async () => {
          await delay(10);
        },
        { connection },
      );
      const grandchildrenWorker = new Worker(
        grandchildrenQueueName,
        async () => {
          await delay(10);
        },
        { connection },
      );

      const worker = new Worker(
        queueName,
        async (job, token) => {
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
                      id: job.id,
                      queue: job.queueQualifiedName,
                    },
                  },
                });
                await job.update({
                  step: Step.Second,
                });
                step = Step.Second;
                break;
              }
              case Step.Second: {
                await job.update({
                  step: Step.Third,
                });
                step = Step.Third;
                break;
              }
              case Step.Third: {
                const shouldWait = await job.moveToWaitingChildren(token);
                if (!shouldWait) {
                  await job.update({
                    step: Step.Finish,
                  });
                  step = Step.Finish;
                  return Step.Finish;
                } else {
                  return;
                }
              }
              default: {
                throw new Error('invalid step');
              }
            }
          }
        },
        { connection },
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
          expect(job.returnvalue).to.equal(Step.Finish);
          resolve();
        });
      });

      await flow.close();
      await worker.close();
      await childrenWorker.close();
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
              if (job.attemptsMade != job.opts.attempts) {
                throw {};
              }
              counter++;
              if (counter === 3) {
                resolve();
              }
              break;
            }
            case 'task2': {
              if (job.attemptsMade != job.opts.attempts) {
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
      });
      const delayTime = 1000;
      await parentWorker.waitUntilReady();

      const flow = new FlowProducer({ connection });
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

      expect(tree).to.have.property('job');
      expect(tree).to.have.property('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).to.be.eql('waiting-children');
      expect(children).to.have.length(1);

      await processingParent;

      await parentWorker.close();

      await flow.close();

      const count = await queue.getJobCountByTypes('completed');

      expect(count).to.be.eql(3);
    });
  });

  describe('when defaultJobOptions is provided', async () => {
    it('processes children before the parent', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const parentQueue = new Queue(parentQueueName, { connection });
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
        expect(nextProcessedCursor).to.be.equal(0);
        expect(Object.keys(processed)).to.have.length(3);

        const childrenValues = await job.getChildrenValues();

        for (let i = 0; i < values.length; i++) {
          const jobKey = queue.toKey(tree.children[i].job.id);
          expect(childrenValues[jobKey]).to.be.deep.equal(values[i]);
        }
      };

      const parentWorker = new Worker(parentQueueName, parentProcessor, {
        connection,
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const completed = new Promise<void>(resolve => {
        parentWorker.on('completed', async (job: Job) => {
          expect(job.finishedOn).to.be.string;
          const gotJob = await parentQueue.getJob(job.id);
          expect(gotJob).to.be.undefined;
          const counts = await parentQueue.getJobCounts('completed');
          expect(counts.completed).to.be.equal(0);
          resolve();
        });
      });

      const flow = new FlowProducer({ connection });
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

      expect(tree).to.have.property('job');
      expect(tree).to.have.property('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).to.be.eql('waiting-children');
      expect(children).to.have.length(3);

      expect(children[0].job.id).to.be.ok;
      expect(children[0].job.data.foo).to.be.eql('bar');
      expect(children[0].job.parent).to.deep.equal({
        id: job.id,
        queueKey: `bull:${parentQueueName}`,
      });
      expect(children[1].job.id).to.be.ok;
      expect(children[1].job.data.foo).to.be.eql('baz');
      expect(children[2].job.id).to.be.ok;
      expect(children[2].job.data.foo).to.be.eql('qux');

      await processingChildren;
      await childrenWorker.close();

      await completed;
      await parentWorker.close();

      await flow.close();

      await removeAllQueueData(new IORedis(), parentQueueName);
    });
  });

  describe('when priority is provided', async () => {
    it('processes children before the parent respecting priority option', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const grandchildrenQueueName = `grandchildren-queue-${v4()}`;
      const parentQueue = new Queue(parentQueueName, { connection });
      const parentName = 'parent-job';
      const grandchildrenName = 'grandchildren-job';
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
            if (job.data.idx !== undefined) {
              expect(job.data.idx).to.be.equal(processedChildren);
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

      const parentProcessor = async (job: Job) => {
        const { processed, nextProcessedCursor } = await job.getDependencies({
          processed: {},
        });
        expect(nextProcessedCursor).to.be.equal(0);
        expect(Object.keys(processed)).to.have.length(3);

        const childrenValues = await job.getChildrenValues();
        expect(Object.keys(childrenValues).length).to.be.equal(3);
      };

      const parentWorker = new Worker(parentQueueName, parentProcessor, {
        connection,
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
      });
      const grandchildrenWorker = new Worker(
        grandchildrenQueueName,
        async () => {},
        {
          connection,
        },
      );
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();
      await grandchildrenWorker.waitUntilReady();

      const completed = new Promise<void>(resolve => {
        parentWorker.on('completed', async (job: Job) => {
          expect(job.finishedOn).to.be.string;
          const gotJob = await parentQueue.getJob(job.id);
          expect(gotJob).to.be.undefined;
          const counts = await parentQueue.getJobCounts('completed');
          expect(counts.completed).to.be.equal(0);
          resolve();
        });
      });

      await queue.add('test', {});
      const flow = new FlowProducer({ connection });
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

      expect(tree).to.have.property('job');
      expect(tree).to.have.property('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).to.be.eql('waiting-children');
      expect(children).to.have.length(3);

      expect(children[0].job.id).to.be.ok;
      expect(children[0].job.data.foo).to.be.eql('baz');
      expect(children[0].job.parent).to.deep.equal({
        id: job.id,
        queueKey: `bull:${parentQueueName}`,
      });
      expect(children[1].job.id).to.be.ok;
      expect(children[1].job.data.foo).to.be.eql('qux');
      expect(children[2].job.id).to.be.ok;
      expect(children[2].job.data.foo).to.be.eql('bar');

      await processingChildren;
      await childrenWorker.close();

      await completed;
      await parentWorker.close();
      await grandchildrenWorker.close();

      await flow.close();

      await removeAllQueueData(new IORedis(), parentQueueName);
    });
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
            if (job.attemptsMade < 2) {
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
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
        settings: {
          backoffStrategies: {
            custom(attemptsMade: number) {
              return attemptsMade * 500;
            },
          },
        },
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const flow = new FlowProducer({ connection });
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

      expect(tree).to.have.property('job');
      expect(tree).to.have.property('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).to.be.eql('waiting-children');
      expect(children).to.have.length(1);

      expect(children[0].job.id).to.be.ok;
      expect(children[0].job.data.foo).to.be.eql('bar');

      await processingChildren;
      await childrenWorker.close();

      await processingParent;
      await parentWorker.close();

      await flow.close();

      await removeAllQueueData(new IORedis(), parentQueueName);
    });
  });

  describe('when continually adding jobs', async () => {
    it('adds jobs that do not exists', async () => {
      const worker = new Worker(queueName, async () => {}, {
        connection,
      });

      const completing1 = new Promise<void>(resolve => {
        worker.on('completed', (job: Job) => {
          if (job.id === 'wed') {
            resolve();
          }
        });
      });

      const flow = new FlowProducer({ connection });
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

      expect(state).to.be.equal('completed');

      await flow.close();
    });
  });

  describe('when custom prefix is set in flow producer', async () => {
    it('uses default prefix to add jobs', async () => {
      const prefix = '{bull}';
      const childrenQueue = new Queue(queueName, { prefix, connection });

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
            expect(nextProcessedCursor).to.be.equal(0);
            expect(Object.keys(processed)).to.have.length(1);

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
        prefix,
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
        prefix,
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const flow = new FlowProducer({ prefix: '{bull}', connection });
      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [{ name, data: { idx: 0, foo: 'bar' }, queueName }],
      });

      expect(tree).to.have.property('job');
      expect(tree).to.have.property('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).to.be.eql('waiting-children');
      expect(children).to.have.length(1);

      expect(children[0].job.id).to.be.ok;
      expect(children[0].job.data.foo).to.be.eql('bar');

      await processingChildren;
      await childrenWorker.close();

      await processingParent;
      await parentWorker.close();

      await flow.close();
      await childrenQueue.close();
      await removeAllQueueData(new IORedis(), parentQueueName, prefix);
      await removeAllQueueData(new IORedis(), queueName, prefix);
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
          await delay(20);
          expect(processedChildren).to.be.equal(job.data.order);

          if (processedChildren === 3) {
            resolve();
          }
          return values[job.data.order - 1];
        };

        grandChildrenProcessor = async (job: Job) => {
          processedGrandChildren++;
          await delay(10);
          expect(processedGrandChildren).to.be.equal(job.data.order);

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
            expect(nextProcessedCursor).to.be.equal(0);
            expect(Object.keys(processed)).to.have.length(3);

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
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
      });
      const grandChildrenWorker = new Worker(
        grandChildrenQueueName,
        grandChildrenProcessor,
        { connection },
      );

      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();
      await grandChildrenWorker.waitUntilReady();

      const flow = new FlowProducer({ connection });
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

      expect(tree).to.have.property('job');
      expect(tree).to.have.property('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).to.be.eql('waiting-children');
      expect(children).to.have.length(3);

      await processingChildren;
      await processingParent;

      await grandChildrenWorker.close();
      await childrenWorker.close();
      await parentWorker.close();

      await flow.close();

      await removeAllQueueData(new IORedis(), parentQueueName);
      await removeAllQueueData(new IORedis(), grandChildrenQueueName);
    });
  });

  describe('when failParentOnFailure option is provided', async () => {
    it('should move parent to failed when child is moved to failed', async () => {
      const name = 'child-job';

      const parentQueueName = `parent-queue-${v4()}`;
      const grandChildrenQueueName = `grand-children-queue-${v4()}`;

      const parentQueue = new Queue(parentQueueName, {
        connection,
      });
      const grandChildrenQueue = new Queue(grandChildrenQueueName, {
        connection,
      });
      const queueEvents = new QueueEvents(parentQueueName, { connection });
      await queueEvents.waitUntilReady();

      let grandChildrenProcessor,
        processedGrandChildren = 0;
      const processingChildren = new Promise<void>(resolve => {
        grandChildrenProcessor = async () => {
          processedGrandChildren++;

          if (processedGrandChildren === 2) {
            return resolve();
          }

          throw new Error('failed');
        };
      });

      const grandChildrenWorker = new Worker(
        grandChildrenQueueName,
        grandChildrenProcessor,
        { connection },
      );

      await grandChildrenWorker.waitUntilReady();

      const flow = new FlowProducer({ connection });
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
            expect(prev).to.be.equal('waiting-children');
            expect(failedReason).to.be.equal(
              `child bull:${queueName}:${tree.children[1].job.id} failed`,
            );
            resolve();
          }
        });
      });

      expect(tree).to.have.property('job');
      expect(tree).to.have.property('children');

      const { children, job } = tree;
      const parentState = await job.getState();

      expect(parentState).to.be.eql('waiting-children');

      await processingChildren;
      await failed;

      const { children: grandChildren } = children[1];
      const updatedGrandchildJob = await grandChildrenQueue.getJob(
        grandChildren[0].job.id,
      );
      const grandChildState = await updatedGrandchildJob.getState();

      expect(grandChildState).to.be.eql('failed');
      expect(updatedGrandchildJob.failedReason).to.be.eql('failed');

      const updatedParentJob = await queue.getJob(children[1].job.id);
      const updatedParentState = await updatedParentJob.getState();

      expect(updatedParentState).to.be.eql('failed');
      expect(updatedParentJob.failedReason).to.be.eql(
        `child bull:${grandChildrenQueueName}:${updatedGrandchildJob.id} failed`,
      );

      const updatedGrandparentJob = await parentQueue.getJob(job.id);
      const updatedGrandparentState = await updatedGrandparentJob.getState();

      expect(updatedGrandparentState).to.be.eql('failed');
      expect(updatedGrandparentJob.failedReason).to.be.eql(
        `child bull:${queueName}:${updatedParentJob.id} failed`,
      );

      await parentQueue.close();
      await grandChildrenWorker.close();
      await flow.close();
      await queueEvents.close();

      await removeAllQueueData(new IORedis(), parentQueueName);
      await removeAllQueueData(new IORedis(), grandChildrenQueueName);
    });
  });

  it('should rate limit by grouping', async function () {
    this.timeout(20000);

    const numGroups = 4;
    const numJobs = 20;
    const startTime = new Date().getTime();

    const queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();

    const name = 'child-job';

    const parentQueueName = `parent-queue-${v4()}`;

    let parentProcessor;
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
    });
    const childrenWorker = new Worker(queueName, async () => {}, {
      connection,
      limiter: {
        max: 1,
        duration: 1000,
        groupKey: 'accountId',
      },
    });
    await parentWorker.waitUntilReady();
    await childrenWorker.waitUntilReady();

    const completed: { [index: string]: number[] } = {};

    const running = new Promise<void>((resolve, reject) => {
      const afterJobs = after(numJobs, () => {
        try {
          const timeDiff = Date.now() - startTime;
          // In some test envs, these timestamps can drift.
          expect(timeDiff).to.be.gte(numGroups * 990);
          expect(timeDiff).to.be.below((numGroups + 1) * 1500);

          for (const group in completed) {
            let prevTime = completed[group][0];
            for (let i = 1; i < completed[group].length; i++) {
              const diff = completed[group][i] - prevTime;
              expect(diff).to.be.lte(2100);
              expect(diff).to.be.gte(970);
              prevTime = completed[group][i];
            }
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      queueEvents.on('completed', ({ jobId }) => {
        const group: string = last(jobId.split(':'));
        completed[group] = completed[group] || [];
        completed[group].push(Date.now());

        afterJobs();
      });

      queueEvents.on('failed', async err => {
        reject(err);
      });
    });

    const flow = new FlowProducer({ connection });

    const childrenData = [];
    for (let i = 0; i < numJobs; i++) {
      childrenData.push({
        name,
        data: { accountId: i % numGroups },
        queueName,
      });
    }

    const { job } = await flow.add(
      {
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: childrenData,
      },
      {
        queuesOptions: {
          [queueName]: {
            limiter: {
              groupKey: 'accountId',
            },
          },
        },
      },
    );

    await running;
    await childrenWorker.close();
    await processingParent;

    const { children } = await flow.getFlow({
      queueName: parentQueueName,
      id: job.id,
    });

    for (const { job: child } of children) {
      expect(child).to.not.be.undefined;
    }

    await parentWorker.close();
    await queueEvents.close();

    await flow.close();

    await removeAllQueueData(new IORedis(), parentQueueName);
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
          expect(nextCursor2).to.be.equal(0);

          resolve();
        } catch (err) {
          console.error(err);
          reject(err);
        }
      }),
    ]);

    const parentWorker = new Worker(parentQueueName, parentProcessor, {
      connection,
    });
    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
    });
    await parentWorker.waitUntilReady();
    await childrenWorker.waitUntilReady();

    const otherValues = Array.from(Array(72).keys()).map(() => ({
      name,
      data: { bar: 'something' },
      queueName,
    }));
    const flow = new FlowProducer({ connection });
    const tree = await flow.add({
      name: 'parent-job',
      queueName: parentQueueName,
      data: {},
      children: otherValues,
    });

    expect(tree).to.have.property('job');
    expect(tree).to.have.property('children');

    const { children, job } = tree;
    const parentState = await job.getState();

    expect(parentState).to.be.eql('waiting-children');
    expect(children).to.have.length(values.length);

    await processingChildren;
    await childrenWorker.close();

    await processingParent;
    await parentWorker.close();

    await flow.close();

    await removeAllQueueData(new IORedis(), parentQueueName);
  });

  it('should get a flow tree', async () => {
    const name = 'child-job';

    const topQueueName = `parent-queue-${v4()}`;

    const flow = new FlowProducer({ connection });
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
      id: topJob.id,
      queueName: topQueueName,
    });

    expect(tree).to.have.property('job');
    expect(tree).to.have.property('children');

    const { children, job } = tree;
    const isWaitingChildren = await job.isWaitingChildren();

    expect(isWaitingChildren).to.be.true;
    expect(children).to.have.length(1);

    expect(children[0].job.id).to.be.ok;
    expect(children[0].job.data.foo).to.be.eql('bar');
    expect(children[0].job.queueName).to.be.eql(queueName);
    expect(children[0].children).to.have.length(1);

    expect(children[0].children[0].job.id).to.be.ok;
    expect(children[0].children[0].job.queueName).to.be.eql(queueName);
    expect(children[0].children[0].job.data.foo).to.be.eql('baz');

    expect(children[0].children[0].children[0].job.id).to.be.ok;
    expect(children[0].children[0].children[0].job.data.foo).to.be.eql('qux');

    await flow.close();

    await removeAllQueueData(new IORedis(), topQueueName);
  });

  it('should get part of flow tree', async () => {
    const name = 'child-job';

    const topQueueName = `parent-queue-${v4()}`;

    const flow = new FlowProducer({ connection });
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
      id: topJob.id,
      queueName: topQueueName,
      depth: 2,
      maxChildren: 2,
    });

    expect(tree).to.have.property('job');
    expect(tree).to.have.property('children');

    const { children, job } = tree;
    const isWaitingChildren = await job.isWaitingChildren();

    expect(isWaitingChildren).to.be.true;
    expect(children.length).to.be.greaterThanOrEqual(2);

    expect(children[0].job.id).to.be.ok;
    expect(children[0].children).to.be.undefined;

    expect(children[1].job.id).to.be.ok;
    expect(children[1].children).to.be.undefined;

    await flow.close();

    await removeAllQueueData(new IORedis(), topQueueName);
  });

  it('should remove processed data when passing removeOnComplete', async () => {
    const name = 'child-job';
    const values = [
      { bar: 'something' },
      { baz: 'something' },
      { qux: 'something' },
    ];

    const parentQueueName = `parent-queue-${v4()}`;

    const parentQueue = new Queue(parentQueueName, { connection });

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
          expect(nextProcessedCursor).to.be.equal(0);
          expect(Object.keys(processed)).to.have.length(3);

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
    });
    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
    });
    await parentWorker.waitUntilReady();
    await childrenWorker.waitUntilReady();

    const waitOnComplete = new Promise<void>((resolve, reject) => {
      parentWorker.on('completed', async job => {
        try {
          const gotJob = await parentQueue.getJob(job.id);
          const { processed } = await job.getDependencies();

          expect(gotJob).to.be.equal(undefined);
          expect(Object.keys(processed).length).to.be.equal(0);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    const flow = new FlowProducer({ connection });
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

    expect(tree).to.have.property('job');
    expect(tree).to.have.property('children');

    const { children, job } = tree;
    const parentState = await job.getState();

    expect(parentState).to.be.eql('waiting-children');
    expect(children).to.have.length(3);

    await processingChildren;
    await childrenWorker.close();

    await processingParent;
    await waitOnComplete;
    await parentWorker.close();

    await flow.close();
    await parentQueue.close();

    await removeAllQueueData(new IORedis(), parentQueueName);
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
    });

    const flow = new FlowProducer({ connection });
    const tree = await flow.add({
      name: 'parent-job',
      queueName: parentQueueName,
      data: {},
      children: [],
    });

    expect(tree).to.have.property('job');
    expect(tree).to.not.have.property('children');

    await processingParent;
    await parentWorker.close();

    await flow.close();

    await removeAllQueueData(new IORedis(), parentQueueName);
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

            expect(processed).to.be.equal(3);
            expect(unprocessed).to.be.equal(0);

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
    });
    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
    });

    const flow = new FlowProducer({ connection });
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

    expect(tree).to.have.property('job');
    expect(tree).to.have.property('children');

    const { children, job } = tree;
    const parentState = await job.getState();

    expect(parentState).to.be.eql('waiting-children');
    expect(children).to.have.length(3);

    const { unprocessed } = await job.getDependencies();

    expect(unprocessed.length).to.be.greaterThan(0);
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
          const waitingChildrenCount = await queue.getWaitingChildrenCount();

          expect(job.data.idx).to.be.eql(values.length - 1 - processedChildren);
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
          expect(Object.keys(processed)).to.have.length(1);

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
    });
    const childrenWorker = new Worker(queueName, childrenProcessor, {
      connection,
    });

    const flow = new FlowProducer({ connection });
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
    });

    const flow = new FlowProducer({ connection });
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

    const parentQueue = new Queue(parentQueueName, { connection });
    const numJobs = await parentQueue.getWaitingCount();
    expect(numJobs).to.be.equal(0);

    await flow.close();
    await parentQueue.close();
    await removeAllQueueData(new IORedis(), parentQueueName);
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
    });

    const processingParent = new Promise<void>(
      resolve =>
        (parentProcessor = async () => {
          resolve();
        }),
    );

    const parentWorker = new Worker(parentQueueName, parentProcessor, {
      connection,
    });

    const parentQueue = new Queue(parentQueueName, { connection });
    await parentQueue.pause();

    const flow = new FlowProducer({ connection });
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

    await flow.close();
    await parentQueue.close();
    await removeAllQueueData(new IORedis(), parentQueueName);
  });

  describe('.addBulk', () => {
    it('should allow parent opts on the root job', async () => {
      const name = 'child-job';
      const values = [{ bar: 'something' }, { baz: 'something' }];

      const parentQueueName = `parent-queue-${v4()}`;
      const grandparentQueueName = `grandparent-queue-${v4()}`;
      const grandparentQueue = new Queue(grandparentQueueName, { connection });
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
            expect(nextProcessedCursor).to.be.equal(0);
            expect(Object.keys(processed)).to.have.length(2);

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
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
      });
      await parentWorker.waitUntilReady();
      await childrenWorker.waitUntilReady();

      const flow = new FlowProducer({ connection });
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
              id: grandparentJob.id,
              queue: `bull:${grandparentQueueName}`,
            },
          },
        },
      ]);

      expect(tree).to.have.property('job');
      expect(tree).to.have.property('children');

      const { children, job } = tree;

      expect(job.parentKey).to.be.equal(
        `bull:${grandparentQueueName}:${grandparentJob.id}`,
      );
      const parentState = await job.getState();

      expect(parentState).to.be.eql('waiting-children');
      expect(children).to.have.length(2);

      await processingChildren;
      await childrenWorker.close();

      await processingParent;
      await parentWorker.close();

      await flow.close();

      await grandparentQueue.close();
      await removeAllQueueData(new IORedis(), grandparentQueueName);
      await removeAllQueueData(new IORedis(), parentQueueName);
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

      const flow = new FlowProducer({ connection });
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

      expect(trees).to.have.length(2);

      expect(trees[0]).to.have.property('job');
      expect(trees[0]).to.have.property('children');

      expect(trees[1]).to.have.property('job');
      expect(trees[1]).to.have.property('children');

      const firstJob = trees[0];
      const isFirstJobWaitingChildren = await firstJob.job.isWaitingChildren();
      expect(isFirstJobWaitingChildren).to.be.true;
      expect(firstJob.children).to.have.length(1);

      expect(firstJob.children[0].job.id).to.be.ok;
      expect(firstJob.children[0].job.data.foo).to.be.eql('bar');
      expect(firstJob.children).to.have.length(1);

      const secondJob = trees[1];
      const isSecondJobWaitingChildren =
        await secondJob.job.isWaitingChildren();
      expect(isSecondJobWaitingChildren).to.be.true;
      expect(secondJob.children).to.have.length(1);

      expect(secondJob.children[0].job.id).to.be.ok;
      expect(secondJob.children[0].job.data.foo).to.be.eql('baz');

      const parentWorker = new Worker(rootQueueName, rootProcessor, {
        connection,
      });
      const childrenWorker = new Worker(queueName, childrenProcessor, {
        connection,
      });

      await processingChildren;
      await childrenWorker.close();

      await processingRoot;
      await parentWorker.close();

      await flow.close();

      await removeAllQueueData(new IORedis(), rootQueueName);
    });
  });

  describe('remove', () => {
    it('should remove all children when removing a parent', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const name = 'child-job';

      const flow = new FlowProducer({ connection });
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

      expect(await tree.job.getState()).to.be.equal('waiting-children');

      expect(await tree.children[0].job.getState()).to.be.equal('waiting');
      expect(await tree.children[1].job.getState()).to.be.equal(
        'waiting-children',
      );

      expect(await tree.children[1].children[0].job.getState()).to.be.equal(
        'waiting',
      );

      for (let i = 0; i < tree.children.length; i++) {
        const child = tree.children[i];
        const childJob = await Job.fromId(queue, child.job.id);
        expect(childJob.parent).to.deep.equal({
          id: tree.job.id,
          queueKey: `bull:${parentQueueName}`,
        });
      }

      await tree.job.remove();

      const parentQueue = new Queue(parentQueueName, { connection });
      const parentJob = await Job.fromId(parentQueue, tree.job.id);
      expect(parentJob).to.be.undefined;

      for (let i = 0; i < tree.children.length; i++) {
        const child = tree.children[i];
        const childJob = await Job.fromId(queue, child.job.id);
        expect(childJob).to.be.undefined;
      }

      expect(await tree.children[0].job.getState()).to.be.equal('unknown');
      expect(await tree.children[1].job.getState()).to.be.equal('unknown');
      expect(await tree.job.getState()).to.be.equal('unknown');

      const jobs = await queue.getJobCountByTypes('waiting');
      expect(jobs).to.be.equal(0);

      await flow.close();
      await parentQueue.close();
      await removeAllQueueData(new IORedis(), parentQueueName);
    });

    describe('when there are processed children', () => {
      it('removes all children when removing a parent', async () => {
        const parentQueueName = `parent-queue-${v4()}`;
        const name = 'child-job';

        const flow = new FlowProducer({ connection });
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

        expect(await tree.job.getState()).to.be.equal('waiting-children');

        expect(await tree.children[0].job.getState()).to.be.equal('waiting');
        expect(await tree.children[1].job.getState()).to.be.equal(
          'waiting-children',
        );

        expect(await tree.children[1].children[0].job.getState()).to.be.equal(
          'waiting',
        );

        for (let i = 0; i < tree.children.length; i++) {
          const child = tree.children[i];
          const childJob = await Job.fromId(queue, child.job.id);
          expect(childJob.parent).to.deep.equal({
            id: tree.job.id,
            queueKey: `bull:${parentQueueName}`,
          });
        }

        const parentWorker = new Worker(parentQueueName, async () => {}, {
          connection,
        });
        const childrenWorker = new Worker(
          queueName,
          async () => {
            await delay(10);
          },
          {
            connection,
          },
        );
        await parentWorker.waitUntilReady();
        await childrenWorker.waitUntilReady();

        const completing = new Promise(resolve => {
          parentWorker.on('completed', resolve);
        });

        await completing;
        await tree.job.remove();

        const parentQueue = new Queue(parentQueueName, { connection });
        const parentJob = await Job.fromId(parentQueue, tree.job.id);
        expect(parentJob).to.be.undefined;

        for (let i = 0; i < tree.children.length; i++) {
          const child = tree.children[i];
          const childJob = await Job.fromId(queue, child.job.id);
          expect(childJob).to.be.undefined;
        }

        const jobs = await queue.getJobCountByTypes('completed');
        expect(jobs).to.be.equal(0);

        expect(await tree.children[0].job.getState()).to.be.equal('unknown');
        expect(await tree.children[1].job.getState()).to.be.equal('unknown');
        expect(await tree.job.getState()).to.be.equal('unknown');

        await flow.close();
        await parentQueue.close();
        await removeAllQueueData(new IORedis(), parentQueueName);
      });
    });

    it('should not remove anything if there is a locked job in the tree', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const name = 'child-job';

      const worker = new Worker(queueName, null, { connection });

      const flow = new FlowProducer({ connection });
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

      expect(nextJob).to.not.be.undefined;
      expect(await (nextJob as Job).getState()).to.be.equal('active');

      await expect(tree.job.remove()).to.be.rejectedWith(
        `Could not remove job ${tree.job.id}`,
      );

      expect(await tree.job.getState()).to.be.equal('waiting-children');
      expect(await tree.children[0].job.getState()).to.be.equal('active');
      expect(await tree.children[1].job.getState()).to.be.equal('waiting');

      await flow.close();
      await worker.close();
      await removeAllQueueData(new IORedis(), parentQueueName);
    });

    it('should remove from parent dependencies and move parent to wait', async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const name = 'child-job';

      const flow = new FlowProducer({ connection });
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
      const parentQueue = new Queue(parentQueueName, { connection });

      await removeChildJob(tree.children[0].children[0]);
      await removeChildJob(tree.children[0]);
      await removeChildJob(tree);

      async function removeChildJob(node: JobNode) {
        expect(await node.job.getState()).to.be.equal('waiting-children');

        await node.children[0].job.remove();

        expect(await node.job.getState()).to.be.equal('waiting');
      }

      await flow.close();
      await parentQueue.close();
      await removeAllQueueData(new IORedis(), parentQueueName);
    });

    it(`should only move parent to wait when all children have been removed`, async () => {
      const parentQueueName = `parent-queue-${v4()}`;
      const name = 'child-job';

      const flow = new FlowProducer({ connection });
      const tree = await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        children: [
          { name, data: { idx: 0, foo: 'bar' }, queueName },
          { name, data: { idx: 0, foo: 'baz' }, queueName },
        ],
      });

      expect(await tree.job.getState()).to.be.equal('waiting-children');
      expect(await tree.children[0].job.getState()).to.be.equal('waiting');

      await tree.children[0].job.remove();

      expect(await tree.children[0].job.getState()).to.be.equal('unknown');
      expect(await tree.job.getState()).to.be.equal('waiting-children');

      await tree.children[1].job.remove();
      expect(await tree.children[1].job.getState()).to.be.equal('unknown');
      expect(await tree.job.getState()).to.be.equal('waiting');

      await flow.close();
      await removeAllQueueData(new IORedis(), parentQueueName);
    });
  });
});
