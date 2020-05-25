import * as IORedis from 'ioredis';
import { Queue, QueueEvents, Job, Worker } from '@src/classes';

import { v4 } from 'uuid';
import { expect } from 'chai';
import { removeAllQueueData } from '@src/utils';

describe('connection', () => {
  let queue: Queue;
  let queueName: string;

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
  });

  afterEach(async () => {
    await queue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('should recover from a connection loss', async () => {
    let processor;

    const processing = new Promise(resolve => {
      processor = async (job: Job) => {
        expect(job.data.foo).to.be.equal('bar');
        resolve();
      };
    });

    const worker = new Worker(queueName, processor);

    worker.on('error', err => {
      // error event has to be observed or the exception will bubble up
    });

    queue.on('error', err => {
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

    const processing = new Promise((resolve, reject) => {
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

    queue.on('error', err => {
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
      connection: { port: 1234, host: '127.0.0.1' },
    });

    return new Promise(async (resolve, reject) => {
      try {
        await queueFail.waitUntilReady();
        reject(new Error('Did not fail connecting to invalid redis instance'));
      } catch (err) {
        expect(err.code).to.be.eql('ECONNREFUSED');
        await queueFail.close();
        resolve();
      }
    });
  });
});
