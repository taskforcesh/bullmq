import * as IORedis from 'ioredis';
import { Queue, Job, Worker, QueueBase } from '../classes';
import { RedisClient } from '../interfaces';

import { v4 } from 'uuid';
import { expect } from 'chai';
import { removeAllQueueData } from '../utils';

describe('connection', () => {
  let queue: Queue;
  let queueName: string;

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection: { host: 'localhost' } });
  });

  afterEach(async function () {
    await queue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should override maxRetriesPerRequest: null and enableReadyCheck: false as redis options', async () => {
    const opts = {
      connection: {
        host: 'localhost',
        maxRetriesPerRequest: 20,
        enableReadyCheck: true,
      },
    };

    function checkOptions(client: RedisClient) {
      expect(
        (<IORedis.RedisOptions>client.options).maxRetriesPerRequest,
      ).to.be.equal(null);
      expect(
        (<IORedis.RedisOptions>client.options).enableReadyCheck,
      ).to.be.equal(false);
    }

    const queue = new QueueBase(queueName, opts);
    checkOptions(await queue.client);
  });

  it('should recover from a connection loss', async () => {
    let processor;

    const processing = new Promise<void>(resolve => {
      processor = async (job: Job) => {
        expect(job.data.foo).to.be.equal('bar');
        resolve();
      };
    });

    const worker = new Worker(queueName, processor);

    worker.on('error', err => {
      // error event has to be observed or the exception will bubble up
    });

    queue.on('error', (err: Error) => {
      // error event has to be observed or the exception will bubble up
    });

    const workerClient = await worker.client;
    const queueClient = await queue.client;

    // Simulate disconnect
    (<any>queueClient).stream.end();
    queueClient.emit('error', new Error('ECONNRESET'));

    (<any>workerClient).stream.end();
    workerClient.emit('error', new Error('ECONNRESET'));

    // add something to the queue
    await queue.add('test', { foo: 'bar' });

    await processing;
    await worker.close();
  });

  it('should handle jobs added before and after a redis disconnect', async () => {
    let count = 0;
    let processor;

    const processing = new Promise<void>((resolve, reject) => {
      processor = async (job: Job) => {
        try {
          if (count == 0) {
            expect(job.data.foo).to.be.equal('bar');
          } else {
            resolve();
          }
          count++;
        } catch (err) {
          reject(err);
        }
      };
    });

    const worker = new Worker(queueName, processor);

    worker.on('error', err => {
      // error event has to be observed or the exception will bubble up
    });

    queue.on('error', (err: Error) => {
      // error event has to be observed or the exception will bubble up
    });

    await worker.waitUntilReady();

    worker.on('completed', async () => {
      if (count === 1) {
        const workerClient = await worker.client;
        const queueClient = await queue.client;

        (<any>queueClient).stream.end();
        queueClient.emit('error', new Error('ECONNRESET'));

        (<any>workerClient).stream.end();
        workerClient.emit('error', new Error('ECONNRESET'));

        await queue.add('test', { foo: 'bar' });
      }
    });

    await queue.waitUntilReady();
    await queue.add('test', { foo: 'bar' });

    await processing;

    await worker.close();
  });

  /*
  it('should not close external connections', () => {
    const client = new redis();
    const subscriber = new redis();

    const opts = {
      createClient(type) {
        switch (type) {
          case 'client':
            return client;
          case 'subscriber':
            return subscriber;
          default:
            return new redis();
        }
      },
    };

    const testQueue = utils.buildQueue('external connections', opts);

    return testQueue
      .isReady()
      .then(() => {
        return testQueue.add({ foo: 'bar' });
      })
      .then(() => {
        expect(testQueue.client).to.be.eql(client);
        expect(testQueue.eclient).to.be.eql(subscriber);

        return testQueue.close();
      })
      .then(() => {
        expect(client.status).to.be.eql('ready');
        expect(subscriber.status).to.be.eql('ready');
        return Promise.all([client.quit(), subscriber.quit()]);
      });
  });
  */

  it('should fail if redis connection fails', async () => {
    const queueFail = new Queue('connection fail port', {
      connection: { port: 1234, host: '127.0.0.1', retryStrategy: () => null },
    });

    await expect(queueFail.waitUntilReady()).to.be.eventually.rejectedWith(
      'connect ECONNREFUSED 127.0.0.1:1234',
    );
  });

  it('should emit error if redis connection fails', async () => {
    const queueFail = new Queue('connection fail port', {
      connection: { port: 1234, host: '127.0.0.1', retryStrategy: () => null },
    });

    const waitingErrorEvent = new Promise<void>((resolve, reject) => {
      queueFail.on('error', (err: Error) => {
        try {
          expect(err.message).to.equal('connect ECONNREFUSED 127.0.0.1:1234');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });

    await waitingErrorEvent;
  });

  it('should close if connection has failed', async () => {
    const queueFail = new Queue('connection fail port', {
      connection: { port: 1234, host: '127.0.0.1', retryStrategy: () => null },
    });

    queueFail.on('error', () => {});

    await expect(queueFail.waitUntilReady()).to.be.rejectedWith(
      'connect ECONNREFUSED 127.0.0.1:1234',
    );

    await expect(queueFail.close()).to.be.eventually.equal(undefined);
  });

  it('should close if connection is failing', async () => {
    const queueFail = new Queue('connection fail port', {
      connection: {
        port: 1234,
        host: '127.0.0.1',
        retryStrategy: times => (times === 0 ? 10 : null),
      },
    });

    await expect(queueFail.close()).to.be.eventually.equal(undefined);

    await expect(queueFail.waitUntilReady()).to.be.eventually.rejectedWith(
      'connect ECONNREFUSED 127.0.0.1:1234',
    );
  });
});
