import { expect } from 'chai';
import { pathToFileURL } from 'url';
import { default as IORedis } from 'ioredis';
import { after } from 'lodash';
import {
  Child,
  FlowProducer,
  Job,
  Queue,
  QueueEvents,
  UNRECOVERABLE_ERROR,
  Worker,
} from '../src/classes';
import { beforeEach, before, after as afterAll, it } from 'mocha';
import { v4 } from 'uuid';
import { delay, removeAllQueueData } from '../src/utils';
const { stdout, stderr } = require('test-console');

describe('Sandboxed process using child processes', () => {
  sandboxProcessTests();

  describe('custom cases', () => {
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
    let queue: Queue;
    let queueEvents: QueueEvents;
    let queueName: string;

    let connection;
    before(async function () {
      connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
    });

    beforeEach(async function () {
      queueName = `test-${v4()}`;
      queue = new Queue(queueName, { connection, prefix });
      queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();
    });

    afterEach(async function () {
      await queue.close();
      await queueEvents.close();
      await removeAllQueueData(new IORedis(), queueName);
    });

    afterAll(async function () {
      await connection.quit();
    });

    it('should allow to pass workerForkOptions', async function () {
      const processFile = __dirname + '/fixtures/fixture_processor.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads: false,
        workerForkOptions: {
          serialization: 'advanced',
        },
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.returnvalue).to.be.eql(42);
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(42);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await completing;

      await worker.close();
    });

    it('should allow to pass workerForkOptions with timeout', async function () {
      const processFile = __dirname + '/fixtures/fixture_processor.js';

      // Note that this timeout will not kill the child process immediately, but
      // will wait for the child process to resolve all its promises before killing it.
      // Therefore the job will not be "cancelled" but will be completed.
      const workerForkOptions = {
        timeout: 1000,
      } as any;
      const worker = new Worker(queueName, processFile, {
        autorun: false,
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads: false,
        workerForkOptions,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job, error) => {
          try {
            const retainedChild = Object.values(
              worker['childPool'].retained,
            )[0];
            expect(retainedChild).to.be.undefined;
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await delay(500);

      await queue.add('test', { foo: 'bar' });

      worker.run();

      await delay(600);

      await completing;

      await worker.close();
    });
  });
});

describe('Sandboxed process using worker threads', () => {
  sandboxProcessTests({ useWorkerThreads: true });

  describe('custom cases', () => {
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
    let queue: Queue;
    let queueEvents: QueueEvents;
    let queueName: string;

    let connection;
    before(async function () {
      connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
    });

    beforeEach(async function () {
      queueName = `test-${v4()}`;
      queue = new Queue(queueName, { connection, prefix });
      queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();
    });

    afterEach(async function () {
      await queue.close();
      await queueEvents.close();
      await removeAllQueueData(new IORedis(), queueName);
    });

    afterAll(async function () {
      await connection.quit();
    });

    it('should allow to pass workerThreadsOptions', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads: true,
        workerThreadsOptions: {
          resourceLimits: {
            maxOldGenerationSizeMb: 20,
          },
        },
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.returnvalue).to.be.eql(42);
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(42);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await completing;

      await worker.close();
    });
  });
});

function sandboxProcessTests(
  { useWorkerThreads } = { useWorkerThreads: false },
) {
  describe('sandboxed process', () => {
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
    let queue: Queue;
    let queueEvents: QueueEvents;
    let queueName: string;

    let connection;
    before(async function () {
      connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
    });

    beforeEach(async function () {
      queueName = `test-${v4()}`;
      queue = new Queue(queueName, { connection, prefix });
      queueEvents = new QueueEvents(queueName, { connection, prefix });
      await queueEvents.waitUntilReady();
    });

    afterEach(async function () {
      await queue.close();
      await queueEvents.close();
      await removeAllQueueData(new IORedis(), queueName);
    });

    afterAll(async function () {
      await connection.quit();
    });

    it('should process and complete', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.returnvalue).to.be.eql(42);
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(42);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await completing;

      await worker.close();
    });

    it('should process and complete when passing a URL', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor.js';
      const processUrl = pathToFileURL(processFile);

      const worker = new Worker(queueName, processUrl, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.returnvalue).to.be.eql(42);
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(42);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processUrl.href]).to.have.lengthOf(
              1,
            );
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await completing;

      await worker.close();
    });

    it('should process and complete using esbuild compiled processor', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_esbuild.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.returnvalue).to.be.eql(42);
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(42);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await completing;

      await worker.close();
    });

    describe('when processor has more than 2 params', () => {
      it('should ignore extra params, process and complete', async () => {
        const processFile =
          __dirname + '/fixtures/fixture_processor_with_extra_param.js';

        const worker = new Worker(queueName, processFile, {
          connection,
          prefix,
          drainDelay: 1,
          useWorkerThreads,
        });

        const completing = new Promise<void>((resolve, reject) => {
          worker.on('completed', async (job: Job, value: any) => {
            try {
              expect(job.data).to.be.eql({ foo: 'bar' });
              expect(value).to.be.eql(42);
              expect(
                Object.keys(worker['childPool'].retained),
              ).to.have.lengthOf(0);
              expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        await queue.add('test', { foo: 'bar' });

        await completing;

        await worker.close();
      });
    });

    describe('when processor file is .cjs (CommonJS)', () => {
      it('processes and completes', async () => {
        const processFile = __dirname + '/fixtures/fixture_processor.cjs';
        const worker = new Worker(queueName, processFile, {
          autorun: false,
          connection,
          prefix,
          drainDelay: 1,
          useWorkerThreads,
        });

        const completing = new Promise<void>((resolve, reject) => {
          worker.on('completed', async (job: Job, value: any) => {
            try {
              expect(job.data).to.be.eql({ foo: 'bar' });
              expect(value).to.be.eql(42);
              expect(
                Object.keys(worker['childPool'].retained),
              ).to.have.lengthOf(0);
              expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        worker.run();

        await queue.add('foobar', { foo: 'bar' });

        await completing;
        await worker.close();
      });
    });

    describe('when there is an output from stdout', () => {
      it('uses the parent stdout', async () => {
        const processFile = __dirname + '/fixtures/fixture_processor_stdout.js';

        const worker = new Worker(queueName, processFile, {
          connection,
          prefix,
          drainDelay: 1,
          useWorkerThreads,
        });

        const completing = new Promise<void>(resolve => {
          worker.on('completed', async (job: Job, value: any) => {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(1);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            resolve();
          });
        });
        const inspect = stdout.inspect();

        await queue.add('test', { foo: 'bar' });

        let output = '';
        inspect.on('data', (chunk: string) => {
          output += chunk;
        });

        await completing;
        inspect.restore();

        expect(output).to.be.equal('message\n');

        await worker.close();
      });
    });

    describe('when there is an output from stderr', () => {
      it('uses the parent stderr', async () => {
        const processFile = __dirname + '/fixtures/fixture_processor_stderr.js';

        const worker = new Worker(queueName, processFile, {
          connection,
          prefix,
          drainDelay: 1,
          useWorkerThreads,
        });

        const completing = new Promise<void>(resolve => {
          worker.on('completed', async (job: Job, value: any) => {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(1);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            resolve();
          });
        });
        const inspect = stderr.inspect();

        await queue.add('test', { foo: 'bar' });

        let output = '';
        inspect.on('data', (chunk: string) => {
          output += chunk;
        });

        await completing;
        inspect.restore();

        expect(output).to.be.equal('error message\n');

        await worker.close();
      });
    });

    describe('when processor throws UnrecoverableError', () => {
      it('moves job to failed', async function () {
        this.timeout(6000);

        const processFile =
          __dirname + '/fixtures/fixture_processor_unrecoverable.js';

        const worker = new Worker(queueName, processFile, {
          connection,
          prefix,
          drainDelay: 1,
          useWorkerThreads,
        });

        await worker.waitUntilReady();

        const start = Date.now();
        const job = await queue.add(
          'test',
          { foo: 'bar' },
          {
            attempts: 5,
            backoff: 1000,
          },
        );

        await new Promise<void>((resolve, reject) => {
          worker.on(
            'failed',
            after(2, (job: Job, error) => {
              try {
                const elapse = Date.now() - start;
                expect(error.name).to.be.eql('UnrecoverableError');
                expect(error.message).to.be.eql(UNRECOVERABLE_ERROR);
                expect(elapse).to.be.greaterThan(1000);
                expect(job.attemptsMade).to.be.eql(2);
                resolve();
              } catch (err) {
                reject(err);
              }
            }),
          );
        });

        const state = await job.getState();

        expect(state).to.be.equal('failed');

        await worker.close();
      });
    });

    it('should process with named processor', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor.js';
      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(42);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('foobar', { foo: 'bar' });

      await completing;
      await worker.close();
    });

    it('should process with concurrent processors', async function () {
      this.timeout(10000);

      await Promise.all([
        queue.add('test', { foo: 'bar1' }),
        queue.add('test', { foo: 'bar2' }),
        queue.add('test', { foo: 'bar3' }),
        queue.add('test', { foo: 'bar4' }),
      ]);

      const processFile = __dirname + '/fixtures/fixture_processor_slow.js';
      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        concurrency: 4,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        const after4 = after(4, () => {
          expect(worker['childPool'].getAllFree().length).to.eql(4);
          resolve();
        });

        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(value).to.be.eql(42);
            expect(
              Object.keys(worker['childPool'].retained).length +
                worker['childPool'].getAllFree().length,
            ).to.eql(4);
            after4();
          } catch (err) {
            reject(err);
          }
        });
      });

      await completing;
      await worker.close();
    });

    it('should reuse process with single processors', async function () {
      this.timeout(20000);

      const processFile = __dirname + '/fixtures/fixture_processor_slow.js';
      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        concurrency: 1,
        drainDelay: 1,
        useWorkerThreads,
      });

      await Promise.all([
        queue.add('1', { foo: 'bar1' }),
        queue.add('2', { foo: 'bar2' }),
        queue.add('3', { foo: 'bar3' }),
        queue.add('4', { foo: 'bar4' }),
      ]);

      const completing = new Promise<void>((resolve, reject) => {
        const after4 = after(4, async () => {
          expect(worker['childPool'].getAllFree().length).to.eql(1);
          resolve();
        });

        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(value).to.be.eql(42);
            expect(
              Object.keys(worker['childPool'].retained).length +
                worker['childPool'].getAllFree().length,
            ).to.eql(1);
            await after4();
          } catch (err) {
            reject(err);
          }
        });
      });

      await completing;
      await worker.close();
    });

    it('should process and update progress', async () => {
      const processFile =
        __dirname + '/fixtures/fixture_processor_update_progress.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const progresses: any[] = [];

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(100);
            expect(job.progress).to.be.eql(100);
            expect(progresses).to.be.eql([10, 27, 78, 100]);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      worker.on('progress', (job, progress) => {
        progresses.push(progress);
      });

      await queue.add('test', { foo: 'bar' });

      await completing;
      await worker.close();
    });

    it('should process and update data', async () => {
      const processFile =
        __dirname + '/fixtures/fixture_processor_update_data.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.data).to.be.eql({ foo: 'baz' });
            expect(value).to.be.eql('result');
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { bar: 'foo' });

      await completing;
      await worker.close();
    });

    it('should process steps and complete', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_steps.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job) => {
          try {
            expect(job.data).to.be.eql({
              step: 'FINISH',
              extraDataSecondStep: 'second data',
              extraDataFinishedStep: 'finish data',
            });
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { step: 'INITIAL' });

      await completing;

      await worker.close();
    });

    it('can get children values by calling getChildrenValues', async () => {
      const childJobId = 'child-job-id';
      const childProcessFile =
        __dirname + '/fixtures/fixture_processor_get_children_values_child.js';
      const parentProcessFile =
        __dirname + '/fixtures/fixture_processor_get_children_values.js';
      const parentQueueName = `parent-queue-${v4()}`;

      const parentWorker = new Worker(parentQueueName, parentProcessFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const childWorker = new Worker(queueName, childProcessFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const parentCompleting = new Promise<void>((resolve, reject) => {
        parentWorker.on('completed', async (job: Job, value: any) => {
          try {
            expect(value).to.be.eql({
              [`${prefix}:${queueName}:${childJobId}`]: { childResult: 'bar' },
            });
            resolve();
          } catch (err) {
            await parentWorker.close();
            reject(err);
          }
        });

        parentWorker.on('failed', async (_, error: Error) => {
          await parentWorker.close();
          reject(error);
        });
      });

      const flow = new FlowProducer({ connection, prefix });
      await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        opts: { jobId: 'job-id' },
        children: [
          { name: 'child-job', queueName, opts: { jobId: childJobId } },
        ],
      });

      await parentCompleting;
      await parentWorker.close();
      await childWorker.close();
      await flow.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it('will fail job if calling getChildrenValues is too slow', async () => {
      // Mockup Job.getChildrenValues to be slow
      const getChildrenValues = Job.prototype.getChildrenValues;
      Job.prototype.getChildrenValues = async function () {
        await delay(50000);
        return getChildrenValues.call(this);
      };

      const childJobId = 'child-job-id';
      const childProcessFile =
        __dirname + '/fixtures/fixture_processor_get_children_values_child.js';
      const parentProcessFile =
        __dirname + '/fixtures/fixture_processor_get_children_values.js';
      const parentQueueName = `parent-queue-${v4()}`;

      const parentWorker = new Worker(parentQueueName, parentProcessFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const childWorker = new Worker(queueName, childProcessFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const parentFailing = new Promise<void>((resolve, reject) => {
        parentWorker.on('failed', async (_, error: Error) => {
          try {
            expect(error.message).to.be.eql(
              'TimeoutError: getChildrenValues timed out in (500ms)',
            );
            resolve();
          } catch (err) {
            await parentWorker.close();
            reject(err);
          }
        });
      });

      const flow = new FlowProducer({ connection, prefix });
      await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        opts: { jobId: 'job-id' },
        children: [
          { name: 'child-job', queueName, opts: { jobId: childJobId } },
        ],
      });

      await parentFailing;
      await parentWorker.close();
      await childWorker.close();
      await flow.close();

      // Restore Job.getChildrenValues
      Job.prototype.getChildrenValues = getChildrenValues;
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it('can get children failures by calling getIgnoredChildrenFailures', async () => {
      const childJobId = 'child-job-id';
      const childProcessFile =
        __dirname +
        '/fixtures/fixture_processor_get_children_failures_child.js';
      const parentProcessFile =
        __dirname + '/fixtures/fixture_processor_get_children_failures.js';
      const parentQueueName = `parent-queue-${v4()}`;

      const parentWorker = new Worker(parentQueueName, parentProcessFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const childWorker = new Worker(queueName, childProcessFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const parentCompleting = new Promise<void>((resolve, reject) => {
        parentWorker.on('completed', async (job: Job, value: any) => {
          try {
            expect(value).to.be.eql({
              [`${prefix}:${queueName}:${childJobId}`]: 'child error',
            });
            resolve();
          } catch (err) {
            await parentWorker.close();
            reject(err);
          }
        });

        parentWorker.on('failed', async (_, error: Error) => {
          await parentWorker.close();
          reject(error);
        });
      });

      const flow = new FlowProducer({ connection, prefix });
      await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        opts: { jobId: 'job-id' },
        children: [
          {
            name: 'child-job',
            queueName,
            opts: { jobId: childJobId, ignoreDependencyOnFailure: true },
          },
        ],
      });

      await parentCompleting;
      await parentWorker.close();
      await childWorker.close();
      await flow.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it('should process and move to delayed', async () => {
      const processFile =
        __dirname + '/fixtures/fixture_processor_move_to_delayed.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const delaying = new Promise<void>((resolve, reject) => {
        queueEvents.on('delayed', async ({ delay }) => {
          try {
            expect(Number(delay)).to.be.lessThanOrEqual(Date.now() + 2500);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              1,
            );
            expect(worker['childPool'].getAllFree()).to.have.lengthOf(0);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job) => {
          expect(job.data.bar).to.be.equal('foo');
          resolve();
        });
      });

      const job = await queue.add('test', { bar: 'foo' });

      await delaying;

      const state = await queue.getJobState(job.id!);

      expect(state).to.be.equal('delayed');

      await completing;
      await worker.close();
    });

    it('should process and move to wait', async () => {
      const processFile =
        __dirname + '/fixtures/fixture_processor_move_to_wait.js';

      const worker = new Worker(queueName, processFile, {
        autorun: false,
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const waiting = new Promise<void>((resolve, reject) => {
        queueEvents.on('waiting', async ({ prev }) => {
          try {
            if (prev) {
              expect(prev).to.be.equal('active');
              expect(
                Object.keys(worker['childPool'].retained),
              ).to.have.lengthOf(1);
              expect(worker['childPool'].getAllFree()).to.have.lengthOf(0);
              resolve();
            }
          } catch (err) {
            console.log(err);
            reject(err);
          }
        });
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job) => {
          expect(job.data.bar).to.be.equal('foo');
          resolve();
        });
      });

      await queue.add('test', { bar: 'foo' });

      worker.run();

      await waiting;

      await completing;
      await worker.close();
    });

    it('should process and move to wait for children', async () => {
      const processFile =
        __dirname + '/fixtures/fixture_processor_move_to_wait_for_children.js';

      const childQueueName = `test-${v4()}`;

      const parentWorker = new Worker(queueName, processFile, {
        autorun: false,
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const childWorker = new Worker(
        childQueueName,
        () => {
          return delay(250);
        },
        {
          autorun: false,
          connection,
          prefix,
          drainDelay: 1,
        },
      );
      const childQueue = new Queue(childQueueName, { connection, prefix });

      const waitingParent = new Promise<void>((resolve, reject) => {
        queueEvents.on('waiting-children', async ({ jobId }) => {
          try {
            if (jobId) {
              expect(jobId).to.be.equal('parent-job-id');
              resolve();
            }
          } catch (err) {
            console.log(err);
            reject(err);
          }
        });
      });

      const completingParent = new Promise<void>((resolve, reject) => {
        parentWorker.on('completed', async (job: Job) => {
          expect(job.data.queueName).to.be.equal(childQueueName);
          expect(job.data.step).to.be.equal('finish');
          expect(job.returnvalue).to.be.equal('finished');
          resolve();
        });
      });

      const completingChild = new Promise<void>((resolve, reject) => {
        childWorker.on('completed', async (job: Job) => {
          expect(job.data.foo).to.be.equal('bar');
          resolve();
        });
      });

      await queue.add(
        'test',
        { redisHost, queueName: childQueueName },
        { jobId: 'parent-job-id' },
      );

      parentWorker.run();
      childWorker.run();

      await waitingParent;
      await completingChild;
      await completingParent;
      await parentWorker.close();
      await childWorker.close();
      await childQueue.close();
      await removeAllQueueData(new IORedis(redisHost), childQueueName);
    });

    describe('when env variables are provided', () => {
      it('shares env variables', async () => {
        const processFile = __dirname + '/fixtures/fixture_processor_env.js';

        const worker = new Worker(queueName, processFile, {
          connection,
          prefix,
          drainDelay: 1,
          useWorkerThreads,
        });

        process.env.variable = 'variable';

        const completing = new Promise<void>((resolve, reject) => {
          worker.on('completed', async (job: Job, value: any) => {
            try {
              expect(job.data).to.be.eql({ foo: 'bar' });
              expect(value).to.be.eql('variable');
              expect(
                Object.keys(worker['childPool'].retained),
              ).to.have.lengthOf(0);
              expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        await queue.add('test', { foo: 'bar' });

        await completing;
        process.env.variable = undefined;
        await worker.close();
      });
    });

    it('includes queueName', async () => {
      const processFile =
        __dirname + '/fixtures/fixture_processor_queueName.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql(queueName);
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await completing;

      await worker.close();
    });

    it('includes parent', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_parent.js';
      const parentQueueName = `parent-queue-${v4()}`;

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async (job: Job, value: any) => {
          try {
            expect(job.data).to.be.eql({ foo: 'bar' });
            expect(value).to.be.eql({
              id: 'job-id',
              queueKey: `${prefix}:${parentQueueName}`,
            });
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      const flow = new FlowProducer({ connection, prefix });
      await flow.add({
        name: 'parent-job',
        queueName: parentQueueName,
        data: {},
        opts: { jobId: 'job-id' },
        children: [{ name: 'child-job', data: { foo: 'bar' }, queueName }],
      });

      await completing;

      await worker.close();
      await flow.close();
      await removeAllQueueData(new IORedis(redisHost), parentQueueName);
    });

    it('should process and fail', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_fail.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const failing = new Promise<void>((resolve, reject) => {
        worker.on('failed', async (job, err) => {
          try {
            expect(job.data).eql({ foo: 'bar' });
            expect(job.failedReason).eql('Manually failed processor');
            expect(err.message).eql('Manually failed processor');
            expect(err.stack).include('fixture_processor_fail.js');
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);

            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await failing;

      await worker.close();
    });

    it('should process and fail when circular reference', async () => {
      const processFile =
        __dirname +
        '/fixtures/fixture_processor_fail_with_circular_reference.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const failing = new Promise<void>((resolve, reject) => {
        worker.on('failed', async (job, err) => {
          try {
            expect(job.data).eql({ foo: 'bar' });
            expect(job.failedReason).eql('error');
            expect(err.message).eql('error');
            expect(err.stack).include(
              'fixture_processor_fail_with_circular_reference.js',
            );
            expect(err.reference).to.equal('[Circular]');
            expect(err.custom).to.deep.equal({ ref: '[Circular]' });
            expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(
              0,
            );
            expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);

            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await failing;

      await worker.close();
    });

    it('should error if processor file is missing', async () => {
      let worker;
      let didThrow = false;
      try {
        const missingProcessFile = __dirname + '/fixtures/missing_processor.js';
        worker = new Worker(queueName, missingProcessFile, {
          connection,
          prefix,
          useWorkerThreads,
        });
      } catch (err) {
        didThrow = true;
      }

      worker && (await worker.close());

      if (!didThrow) {
        throw new Error('did not throw error');
      }
    });

    it('should error if processor file passed as URL is missing', async () => {
      let worker;
      let didThrow = false;
      try {
        const missingProcessFile = __dirname + '/fixtures/missing_processor.js';
        const missingProcessUrl = pathToFileURL(missingProcessFile);
        worker = new Worker(queueName, missingProcessUrl, {
          connection,
          prefix,
          useWorkerThreads,
        });
      } catch (err) {
        didThrow = true;
      }

      worker && (await worker.close());

      if (!didThrow) {
        throw new Error('did not throw error');
      }
    });

    it('should fail if the process crashes', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_crash.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const job = await queue.add('test', {});

      await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
        'boom!',
      );

      await worker.close();
    });

    it('should fail if the process exits 0', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_crash.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const job = await queue.add('test', { exitCode: 0 });

      await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
        'Unexpected exit code: 0 signal: null',
      );

      await worker.close();
    });

    it('should fail if the process exits non-0', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_crash.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const job = await queue.add('test', { exitCode: 1 });

      await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
        'Unexpected exit code: 1 signal: null',
      );

      await worker.close();

      const failedJobs = await queue.getFailed();
      expect(failedJobs).to.have.lengthOf(1);
      expect(failedJobs[0].failedReason).to.be.equal(
        'Unexpected exit code: 1 signal: null',
      );
    });

    it('should fail if wrapping with ttl pattern', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_ttl.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const job = await queue.add('test', { exitCode: 1 });

      await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
        'Unexpected exit code: 10 signal: null',
      );

      await worker.close();

      const failedJobs = await queue.getFailed();
      expect(failedJobs).to.have.lengthOf(1);
      expect(failedJobs[0].failedReason).to.be.equal(
        'Unexpected exit code: 10 signal: null',
      );

      expect(failedJobs[0].progress).to.be.equal(50);
    });

    it('should fail if the process file is broken', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_broken.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const failing = new Promise<void>((resolve, reject) => {
        worker.on('failed', async (job, error) => {
          try {
            expect(error.message).to.be.equal('Broken file processor');
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { exitCode: 1 });

      await failing;
      await worker.close();
    });

    describe('when child process a job and its killed direcly after completing', () => {
      it('should process the next job in a new child process', async () => {
        const processFile = __dirname + '/fixtures/fixture_processor.js';
        const worker = new Worker(queueName, processFile, {
          connection,
          prefix,
          drainDelay: 1,
          useWorkerThreads,
        });

        let counter = 0;
        let completing;
        const completing2 = new Promise<void>((resolve2, reject2) => {
          completing = new Promise<void>((resolve, reject) => {
            worker.on('completed', async (job: Job, value: any) => {
              try {
                expect(job.data).to.be.eql({ foo: 'bar' });
                expect(value).to.be.eql(42);
                expect(
                  Object.keys(worker['childPool'].retained),
                ).to.have.lengthOf(0);
                expect(worker['childPool'].free[processFile]).to.have.lengthOf(
                  1,
                );
                if (counter == 0) {
                  counter++;
                  resolve();
                } else {
                  resolve2();
                }
              } catch (err) {
                if (counter == 0) {
                  return reject(err);
                }
                reject2(err);
              }
            });
          });
        });

        await queue.add('foobar', { foo: 'bar' });

        await completing;

        const child1 = worker['childPool'].free[processFile][0];

        await child1.kill('SIGTERM');

        await queue.add('foobar', { foo: 'bar' });

        await completing2;

        const child2 = worker['childPool'].free[processFile][0];

        expect(child1).to.not.equal(child2);

        await worker.close();
      });
    });

    describe('when child process a job and its killed with SIGKILL while processing', () => {
      it('should fail with an unexpected error', async function () {
        const processFile = __dirname + '/fixtures/fixture_processor.js';

        const worker = new Worker(queueName, processFile, {
          autorun: false,
          connection,
          prefix,
          drainDelay: 1,
        });

        const started = new Promise<void>((resolve, reject) => {
          worker.on('active', async (job, prev) => {
            expect(prev).to.be.equal('waiting');
            resolve();
          });
        });

        const failing = new Promise<void>((resolve, reject) => {
          worker.on('failed', async (job, error) => {
            try {
              expect([
                'Unexpected exit code: null signal: SIGKILL',
                'Unexpected exit code: 0 signal: null',
              ]).to.include(error.message);
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        await queue.add('test', { foo: 'bar' });

        worker.run();

        await started;

        // Need some time to create the child job and start processing
        await delay(250);

        const retainedChild = Object.values(worker['childPool'].retained)[0];
        await retainedChild.kill('SIGKILL');

        await failing;

        await worker.close();
      });
    });

    describe('when function is not exported', () => {
      it('throws an error', async () => {
        const processFile =
          __dirname + '/fixtures/fixture_processor_missing_function.js';

        const worker = new Worker(queueName, processFile, {
          connection,
          prefix,
          drainDelay: 1,
          useWorkerThreads,
        });

        const job = await queue.add('test', {});

        await expect(job.waitUntilFinished(queueEvents)).to.be.rejectedWith(
          'No function is exported in processor file',
        );

        await worker.close();
      });
    });

    it('should release exited process', async () => {
      const processFile = __dirname + '/fixtures/fixture_processor_exit.js';

      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        drainDelay: 1,
        useWorkerThreads,
      });

      const completing = new Promise<void>((resolve, reject) => {
        worker.on('completed', async job => {
          try {
            expect(job!.returnvalue).to.be.undefined;
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });

      await queue.add('test', { foo: 'bar' });

      await completing;

      await delay(200);

      expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(0);
      expect(worker['childPool'].getAllFree()).to.have.lengthOf(0);

      await worker.close();
    });

    it('should allow the job to complete and then exit on worker close', async function () {
      this.timeout(15000);
      const processFile = __dirname + '/fixtures/fixture_processor_slow.js';
      const worker = new Worker(queueName, processFile, {
        connection,
        prefix,
        useWorkerThreads,
      });

      // acquire and release a child here so we know it has it's full termination handler setup
      const initializedChild = await worker['childPool'].retain(
        processFile,
        () => {},
      );
      await worker['childPool'].release(initializedChild);

      // await this After we've added the job
      const onJobActive = new Promise<void>(resolve => {
        worker.on('active', (job, prev) => {
          expect(prev).to.be.equal('waiting');
          resolve();
        });
      });

      const jobAdd = queue.add('foo', {});
      await onJobActive;

      expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(1);
      expect(worker['childPool'].getAllFree()).to.have.lengthOf(0);
      const child = Object.values(worker['childPool'].retained)[0] as Child;

      expect(child).to.equal(initializedChild);
      expect(child.exitCode).to.equal(null);
      expect(child.killed).to.equal(false);

      // at this point the job should be active and running on the child
      // trigger a close while we know it's doing work
      await worker.close();

      // ensure the child did get cleaned up
      expect(!!child.killed).to.eql(true);
      expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(0);
      expect(worker['childPool'].getAllFree()).to.have.lengthOf(0);

      const job = await jobAdd;
      // check that the job did finish successfully
      const jobResult = await job.waitUntilFinished(queueEvents);
      expect(jobResult).to.equal(42);
    });
  });
}
