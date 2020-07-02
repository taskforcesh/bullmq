import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { after } from 'lodash';
import { Queue, QueueEvents, Worker } from '@src/classes';
import { beforeEach } from 'mocha';
import { v4 } from 'uuid';
import { delay, removeAllQueueData } from '@src/utils';
const pReflect = require('p-reflect');

describe('sandboxed process', () => {
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
    queueEvents = new QueueEvents(queueName);
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should process and complete', async () => {
    const processFile = __dirname + '/fixtures/fixture_processor.js';

    const worker = new Worker(queueName, processFile, {
      drainDelay: 1,
    });

    const completting = new Promise((resolve, reject) => {
      worker.on('completed', async (job, value) => {
        try {
          expect(job.data).to.be.eql({ foo: 'bar' });
          expect(value).to.be.eql(42);
          expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(0);
          expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
          await worker.close();
          resolve();
        } catch (err) {
          await worker.close();
          reject(err);
        }
      });
    });

    await queue.add('test', { foo: 'bar' });

    await completting;

    await worker.close();
  });

  it('should process with named processor', async () => {
    const processFile = __dirname + '/fixtures/fixture_processor.js';
    const worker = new Worker(queueName, processFile, {
      drainDelay: 1,
    });

    const completting = new Promise((resolve, reject) => {
      worker.on('completed', async (job, value) => {
        try {
          expect(job.data).to.be.eql({ foo: 'bar' });
          expect(value).to.be.eql(42);
          expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(0);
          expect(worker['childPool'].free[processFile]).to.have.lengthOf(1);
          await worker.close();
          resolve();
        } catch (err) {
          await worker.close();
          reject(err);
        }
      });
    });

    await queue.add('foobar', { foo: 'bar' });

    await completting;
  });

  it('should process with concurrent processors', async function() {
    this.timeout(10000);

    let worker: Worker;

    await Promise.all([
      queue.add('test', { foo: 'bar1' }),
      queue.add('test', { foo: 'bar2' }),
      queue.add('test', { foo: 'bar3' }),
      queue.add('test', { foo: 'bar4' }),
    ]);

    const processFile = __dirname + '/fixtures/fixture_processor_slow.js';
    worker = new Worker(queueName, processFile, {
      concurrency: 4,
      drainDelay: 1,
    });

    const completing = new Promise((resolve, reject) => {
      const after4 = after(4, () => {
        expect(worker['childPool'].getAllFree().length).to.eql(4);
        resolve();
      });

      worker.on('completed', async (job, value) => {
        try {
          expect(value).to.be.eql(42);
          expect(
            Object.keys(worker['childPool'].retained).length +
              worker['childPool'].getAllFree().length,
          ).to.eql(4);
          after4();
        } catch (err) {
          await worker.close();
          reject(err);
        }
      });
    });

    await completing;
    await worker.close();
  });

  it('should reuse process with single processors', async function() {
    this.timeout(30000);

    let worker: Worker;
    const processFile = __dirname + '/fixtures/fixture_processor_slow.js';
    worker = new Worker(queueName, processFile, {
      concurrency: 1,
      drainDelay: 1,
    });

    await Promise.all([
      queue.add('1', { foo: 'bar1' }),
      queue.add('2', { foo: 'bar2' }),
      queue.add('3', { foo: 'bar3' }),
      queue.add('4', { foo: 'bar4' }),
    ]);

    const completting = new Promise((resolve, reject) => {
      const after4 = after(4, async () => {
        expect(worker['childPool'].getAllFree().length).to.eql(1);
        await worker.close();
        resolve();
      });

      worker.on('completed', async (job, value) => {
        try {
          expect(value).to.be.eql(42);
          expect(
            Object.keys(worker['childPool'].retained).length +
              worker['childPool'].getAllFree().length,
          ).to.eql(1);
          await after4();
        } catch (err) {
          await worker.close();
          reject(err);
        }
      });
    });

    await completting;
  });

  it('should process and update progress', async () => {
    const processFile = __dirname + '/fixtures/fixture_processor_progress.js';

    const worker = new Worker(queueName, processFile, {
      drainDelay: 1,
    });

    const progresses: any[] = [];

    const completing = new Promise((resolve, reject) => {
      worker.on('completed', async (job, value) => {
        try {
          expect(job.data).to.be.eql({ foo: 'bar' });
          expect(value).to.be.eql(37);
          expect(job.progress).to.be.eql(100);
          expect(progresses).to.be.eql([10, 27, 78, 100]);
          expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(0);
          expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);
          const logs = await queue.getJobLogs(job.id);
          expect(logs).to.be.eql({
            logs: ['10', '27', '78', '100'],
            count: 4,
          });
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

  it('should process and fail', async () => {
    const processFile = __dirname + '/fixtures/fixture_processor_fail.js';

    const worker = new Worker(queueName, processFile, {
      drainDelay: 1,
    });

    const failing = new Promise((resolve, reject) => {
      worker.on('failed', async (job, err) => {
        try {
          expect(job.data).eql({ foo: 'bar' });
          expect(job.failedReason).eql('Manually failed processor');
          expect(err.message).eql('Manually failed processor');
          expect(err.stack).include('fixture_processor_fail.js');
          expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(0);
          expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);

          resolve();
        } catch (err) {
          await worker.close();
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
      worker = new Worker(queueName, missingProcessFile, {});
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
      drainDelay: 1,
    });

    const job = await queue.add('test', {});
    const inspection = await pReflect(
      Promise.resolve(job.waitUntilFinished(queueEvents)),
    );
    expect(inspection.isRejected).to.be.eql(true);
    expect(inspection.reason.message).to.be.eql('boom!');
  });

  it('should fail if the process exits 0', async () => {
    const processFile = __dirname + '/fixtures/fixture_processor_crash.js';

    new Worker(queueName, processFile, {
      drainDelay: 1,
    });

    const job = await queue.add('test', { exitCode: 0 });
    const inspection = await pReflect(
      Promise.resolve(job.waitUntilFinished(queueEvents)),
    );
    expect(inspection.isRejected).to.be.eql(true);
    expect(inspection.reason.message).to.be.eql(
      'Unexpected exit code: 0 signal: null',
    );
  });

  it('should fail if the process exits non-0', async () => {
    const processFile = __dirname + '/fixtures/fixture_processor_crash.js';

    new Worker(queueName, processFile, {
      drainDelay: 1,
    });

    const job = await queue.add('test', { exitCode: 1 });
    const inspection = await pReflect(
      Promise.resolve(job.waitUntilFinished(queueEvents)),
    );
    expect(inspection.isRejected).to.be.eql(true);
    expect(inspection.reason.message).to.be.eql(
      'Unexpected exit code: 1 signal: null',
    );
  });

  it('should remove exited process', async () => {
    const processFile = __dirname + '/fixtures/fixture_processor_exit.js';

    const worker = new Worker(queueName, processFile, {
      drainDelay: 1,
    });

    const completting = new Promise((resolve, reject) => {
      worker.on('completed', async () => {
        try {
          expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(0);
          expect(worker['childPool'].getAllFree()).to.have.lengthOf(1);
          await delay(500);
          expect(Object.keys(worker['childPool'].retained)).to.have.lengthOf(0);
          expect(worker['childPool'].getAllFree()).to.have.lengthOf(0);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await queue.add('test', { foo: 'bar' });

    await completting;

    await worker.close();
  });
});
