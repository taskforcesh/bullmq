import { expect } from 'chai';
import { default as IORedis, RedisOptions } from 'ioredis';
import { v4 } from 'uuid';
import { Queue, Job, Worker, QueueBase } from '../src/classes';
import { removeAllQueueData } from '../src/utils';
import {
  before,
  describe,
  it,
  beforeEach,
  afterEach,
  after as afterAll,
} from 'mocha';

describe('connection', () => {
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

  afterAll(async function () {
    await connection.quit();
  });

  describe('establish ioredis connection', () => {
    it('should connect with host:port', async () => {
      const queue = new Queue('valid-host-port', {
        connection: {
          host: 'localhost',
          port: 6379,
          retryStrategy: () => null,
        },
      });

      const client = await queue.waitUntilReady();
      expect(client.status).to.be.eql('ready');

      await queue.close();
    });

    it('should fail with invalid host:port', async () => {
      const queue = new Queue('invalid-host-port', {
        connection: {
          host: 'localhost',
          port: 9000,
          retryStrategy: () => null,
        },
      });

      await expect(queue.waitUntilReady()).to.be.eventually.rejectedWith(
        'connect ECONNREFUSED 127.0.0.1:9000',
      );
    });

    it('should connect with connection URL', async () => {
      const queue = new Queue('valid-url', {
        connection: {
          url: 'redis://localhost:6379',
          // Make sure defaults are not being used
          host: '1.1.1.1',
          port: 2222,
          retryStrategy: () => null,
        },
      });

      const client = await queue.waitUntilReady();
      expect(client.status).to.be.eql('ready');

      await queue.close();
    });

    it('should fail with invalid connection URL', async () => {
      const queue = new Queue('invalid-url', {
        connection: {
          url: 'redis://localhost:9001',
          // Make sure defaults are not being used
          host: '1.1.1.1',
          port: 2222,
          retryStrategy: () => null,
        },
      });

      await expect(queue.waitUntilReady()).to.be.eventually.rejectedWith(
        'connect ECONNREFUSED 127.0.0.1:9001',
      );
    });
  });

  describe('prefix', () => {
    it('should throw exception if using prefix with ioredis', async () => {
      const connection = new IORedis({
        host: redisHost,
        keyPrefix: 'bullmq',
      });

      expect(() => new QueueBase(queueName, { connection })).to.throw(
        'BullMQ: ioredis does not support ioredis prefixes, use the prefix option instead.',
      );
      await connection.disconnect();
    });

    it('should throw exception if using prefix with ioredis in cluster mode', async () => {
      const connection = new IORedis.Cluster(
        [{ host: '10.0.6.161', port: 7379 }],
        {
          keyPrefix: 'bullmq',
          natMap: {},
        },
      );

      expect(() => new QueueBase(queueName, { connection })).to.throw(
        'BullMQ: ioredis does not support ioredis prefixes, use the prefix option instead.',
      );
      await connection.disconnect();
    });
  });

  describe('blocking', () => {
    it('should override maxRetriesPerRequest: null as redis options', async () => {
      if (redisHost === 'localhost') {
        // We cannot currently test this behaviour for remote redis servers
        const queue = new QueueBase(queueName, {
          connection: { host: 'localhost' },
        });

        const options = connection.options;

        expect(options.maxRetriesPerRequest).to.be.equal(null);

        await queue.close();
      }
    });
  });

  describe('non-blocking', () => {
    it('should not override any redis options', async () => {
      const connection2 = new IORedis(redisHost, { maxRetriesPerRequest: 20 });

      const queue = new Queue(queueName, {
        connection: connection2,
      });

      const options = <RedisOptions>(await queue.client).options;

      expect(options.maxRetriesPerRequest).to.be.equal(20);

      await queue.close();
      await connection2.quit();
    });
  });

  describe('when maxmemory-policy is different than noeviction in Redis', () => {
    it.skip('throws an error', async () => {
      const opts = {
        connection: {
          host: 'localhost',
        },
      };

      const queue = new QueueBase(queueName, opts);
      const client = await queue.client;
      await client.config('SET', 'maxmemory-policy', 'volatile-lru');

      const queue2 = new QueueBase(`${queueName}2`, opts);

      await expect(queue2.client).to.be.eventually.rejectedWith(
        'Eviction policy is volatile-lru. It should be "noeviction"',
      );
      await client.config('SET', 'maxmemory-policy', 'noeviction');

      await queue.close();
      await queue2.close();
    });
  });

  describe('when instantiating with a clustered ioredis connection', () => {
    it('should not fail when using dsn strings', async () => {
      const connection = new IORedis.Cluster(['redis://10.0.6.161:7379'], {
        natMap: {},
      });
      const queue = new Queue('myqueue', { connection });
      connection.disconnect();
    });
  });

  it('should close worker even if redis is down', async () => {
    const connection = new IORedis('badhost', { maxRetriesPerRequest: null });
    connection.on('error', () => {});

    const worker = new Worker('test', async () => {}, { connection, prefix });

    worker.on('error', err => {});
    await worker.close();
  });

  it('should close underlying redis connection when closing fast', async () => {
    const queue = new Queue('CALLS_JOB_QUEUE_NAME', {
      connection: {
        host: 'localhost',
        port: 6379,
      },
    });

    const client = queue['connection']['_client'];
    await queue.close();

    expect(client.status).to.be.eql('end');
  });

  it('should recover from a connection loss', async () => {
    let processor;

    const processing = new Promise<void>(resolve => {
      processor = async (job: Job) => {
        expect(job.data.foo).to.be.equal('bar');
        resolve();
      };
    });

    const worker = new Worker(queueName, processor, { connection, prefix });

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
    await queue.add('test', { foo: 'bar' }, { delay: 2000 });

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

    const worker = new Worker(queueName, processor, { connection, prefix });

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

    await expect(queueFail.waitUntilReady()).to.be.eventually.rejectedWith(
      'connect ECONNREFUSED 127.0.0.1:1234',
    );

    await expect(queueFail.close()).to.be.eventually.equal(undefined);
  });
});
