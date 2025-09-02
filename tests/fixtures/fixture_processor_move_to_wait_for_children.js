/**
 * A processor file to be used in tests.
 *
 */
'use strict';

const { WaitingChildrenError, Queue } = require('../../dist/cjs/classes');
const IORedis = require('ioredis');
const delay = require('./delay');

const Step = {
  Initial: 'initial',
  WaitingChildren: 'waiting-children',
  Finish: 'finish',
};

module.exports = async function (job, token) {
  let step = job.data.step ?? Step.Initial;
  while (step !== Step.Finish) {
    switch (step) {
      case Step.Initial: {
        await addChildJob(job);
        step = Step.WaitingChildren;
        await job.updateData({ ...job.data, step });
        break;
      }
      case Step.WaitingChildren: {
        const shouldWait = await job.moveToWaitingChildren(token);
        if (!shouldWait) {
          step = Step.Finish;
          await job.updateData({ ...job.data, step });
          return 'finished';
        } else {
          throw new WaitingChildrenError();
        }
      }
      default: {
        throw new Error('invalid step');
      }
    }
  }
};

async function addChildJob(job) {
  const connection = new IORedis(job.data.redisHost, {
    maxRetriesPerRequest: null,
  });
  const queue = new Queue(job.data.queueName, {
    connection,
    prefix: job.prefix,
  });
  await queue.add(
    'child-job',
    { foo: 'bar' },
    {
      parent: {
        id: job.id,
        queue: job.queueQualifiedName,
      },
    },
  );
  await queue.close();
  await connection.quit();
}
