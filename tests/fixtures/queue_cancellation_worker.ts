'use strict';

const IORedis = require('ioredis');
const { Worker } = require('../../src/classes');
const { createIORedisClient } = require('../../src/classes/ioredis-client');

const connection = new IORedis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  maxRetriesPerRequest: null,
});
const worker = new Worker(
  process.env.BULLMQ_TEST_QUEUE,
  async (_job, _token, signal) => {
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        process.send?.({ cancelled: true });
        reject(new Error('cancelled'));
      });
      setTimeout(resolve, 10000);
    });
  },
  {
    connection: createIORedisClient(connection),
    prefix: process.env.BULLMQ_TEST_PREFIX,
    name: 'queue-cancellation-child',
  },
);

worker.once('ready', () => process.send?.({ ready: true }));
worker.once('error', error => process.send?.({ error: error.message }));
process.on('message', message => {
  if (message?.shutdown) {
    worker.close().finally(() => process.exit(0));
  }
});
