import IORedis from 'ioredis';
import { Queue, QueueEvents, Job, Worker } from '@src/classes';

import { v4 } from 'node-uuid';
import { expect } from 'chai';

describe('connection', () => {
  let queue: Queue;
  let queueName: string;
  let client: IORedis.Redis;

  beforeEach(function() {
    client = new IORedis();
    return client.flushdb();
  });

  beforeEach(function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName, {
      connection: { port: 6379, host: '127.0.0.1' },
    });
  });

  afterEach(async () => {
    await client.quit();
    await queue.close();
  });

  it('should recover from a connection loss', async () => {
    let processor;
    queue.on('error', () => {
      // error event has to be observed or the exception will bubble up
    });

    const processing = new Promise(resolve => {
      processor = async (job: Job) => {
        expect(job.data.foo).to.be.equal('bar');
        resolve();
      };
    });

    const worker = new Worker(queueName, processor);

    await worker.waitUntilReady();
    await queue.waitUntilReady();

    // Simulate disconnect
    (<any>queue.client).stream.end();
    queue.client.emit('error', new Error('ECONNRESET'));

    (<any>worker.client).stream.end();
    worker.client.emit('error', new Error('ECONNRESET'));

    // add something to the queue
    await queue.append('test', { foo: 'bar' });

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
            await worker.close();
            resolve();
          }
          count++;
        } catch (err) {
          reject(err);
        }
      };
    });

    const worker = new Worker(queueName, processor);
    await worker.waitUntilReady();

    worker.on('completed', () => {
      if (count === 1) {
        (<any>queue.client).stream.end();
        queue.client.emit('error', new Error('ECONNRESET'));

        (<any>worker.client).stream.end();
        worker.client.emit('error', new Error('ECONNRESET'));

        queue.append('test', { foo: 'bar' });
      }
    });

    await queue.waitUntilReady();
    await queue.append('test', { foo: 'bar' });

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
