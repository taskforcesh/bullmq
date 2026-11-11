'use strict';

const { Queue } = require('../../dist/cjs');
const IORedis = require('ioredis');

module.exports = async function (job) {
  if (job.data.operation === 'reject') {
    try {
      await job.updateData({ value: BigInt(1) });
      return { rejected: false };
    } catch (error) {
      return {
        rejected: error.name === 'TypeError' && /BigInt/i.test(error.message),
        localType: typeof job.data.value,
      };
    }
  }

  const connection = new IORedis(process.env.REDIS_HOST || 'localhost');
  const queue = new Queue(job.queueName, {
    connection,
    prefix: job.queueQualifiedName.slice(0, -job.queueName.length - 1),
  });

  try {
    await queue.waitUntilReady();
    // Reads remain available while the actual persistence command is delayed.
    await connection.client('PAUSE', 500, 'WRITE');
    await job.updateData({ updated: true });
    return { persisted: (await queue.getJob(job.id)).data, local: job.data };
  } finally {
    await queue.close();
    await connection.quit();
  }
};
