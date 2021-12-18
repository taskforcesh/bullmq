import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { describe, it } from 'mocha';
import { Queue, Job, Worker } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('workers', function () {
  it('failure', async () => {
    const connection = new IORedis({
      host: 'localhost',
    });

    const queue1 = new Queue('myqueue', { connection });

    let counter = 1;
    const maxJobs = 35;

    let processor;
    const processing = new Promise<void>((resolve, reject) => {
      processor = async (job: Job) => {
        try {
          expect(job.data.num).to.be.equal(counter);
          expect(job.data.foo).to.be.equal('bar');
          if (counter === maxJobs) {
            resolve();
          }
          counter++;
        } catch (err) {
          reject(err);
        }
      };
    });

    const worker = new Worker('myqueue', processor, { connection });
    await worker.waitUntilReady();

    for (let i = 1; i <= maxJobs; i++) {
      await queue1.add('test', { foo: 'bar', num: i });
    }

    await processing;
    expect(worker.isRunning()).to.be.equal(true);

    await worker.close();
    await queue1.close();
    await removeAllQueueData(new IORedis(), 'myqueue');
  });
});
