import { Queue, QueueEvents, Job, Worker } from '@src/classes';
import { describe, beforeEach, it } from 'mocha';
import { expect } from 'chai';
import IORedis from 'ioredis';
import { v4 } from 'node-uuid';

describe('workers', function() {
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;
  let client: IORedis.Redis;

  beforeEach(function() {
    client = new IORedis();
    return client.flushdb();
  });

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
    queueEvents = new QueueEvents(queueName);
  });

  afterEach(async function() {
    await queue.close();
    await queueEvents.close();
    return client.quit();
  });

  it('should get all workers for this queue', async function() {
    const worker = new Worker(queueName, async job => {});
    await worker.waitUntilReady();

    const workers = await queue.getWorkers();
    expect(workers).to.have.length(1);
    return worker.close();
  });

  describe('auto job removal', () => {
    it('should remove job after completed if removeOnComplete', async () => {
      const worker = new Worker(queueName, async job => {
        expect(job.data.foo).to.be.equal('bar');
      });
      await worker.waitUntilReady();

      const job = await queue.append(
        'test',
        { foo: 'bar' },
        { removeOnComplete: true },
      );
      expect(job.id).to.be.ok;
      expect(job.data.foo).to.be.eql('bar');

      return new Promise((resolve, reject) => {
        worker.on('completed', async (job: Job) => {
          try {
            const gotJob = await queue.getJob(job.id);
            expect(gotJob).to.be.equal(null);
            const counts = await queue.getJobCounts('completed');
            expect(counts.completed).to.be.equal(0);
            await worker.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });

    it('should remove a job after completed if the default job options specify removeOnComplete', async () => {
      const newQueue = new Queue(queueName, {
        defaultJobOptions: {
          removeOnComplete: true,
        },
      });

      const worker = new Worker(queueName, async job => {
        expect(job.data.foo).to.be.equal('bar');
      });
      await worker.waitUntilReady();

      const job = await newQueue.append('test', { foo: 'bar' });
      expect(job.id).to.be.ok;
      expect(job.data.foo).to.be.eql('bar');

      return new Promise((resolve, reject) => {
        worker.on('completed', async job => {
          try {
            const gotJob = await newQueue.getJob(job.id);
            expect(gotJob).to.be.equal(null);
            const counts = await newQueue.getJobCounts('completed');
            expect(counts.completed).to.be.equal(0);
            await worker.close();
            await newQueue.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      });
    });

    it('should keep specified number of jobs after completed with removeOnComplete', async () => {
      const keepJobs = 3;

      const worker = new Worker(queueName, async job => {
        await job.log('test log');
      });
      await worker.waitUntilReady();

      const datas = [0, 1, 2, 3, 4, 5, 6, 7, 8];

      const jobIds = await Promise.all(
        datas.map(
          async data =>
            (await queue.append('test', data, { removeOnComplete: keepJobs }))
              .id,
        ),
      );

      return new Promise(resolve => {
        worker.on('completed', async job => {
          if (job.data == 8) {
            const counts = await queue.getJobCounts('completed');
            expect(counts.completed).to.be.equal(keepJobs);

            await Promise.all(
              jobIds.map(async (jobId, index) => {
                const job = await queue.getJob(jobId);
                const logs = await queue.getJobLogs(jobId);
                if (index >= datas.length - keepJobs) {
                  expect(job).to.not.be.equal(null);
                  expect(logs.logs).to.not.be.empty;
                } else {
                  expect(job).to.be.equal(null);
                  expect(logs.logs).to.be.empty;
                }
              }),
            );
            await worker.close();
            resolve();
          }
        });
      });
    });

    it('should keep specified number of jobs after completed with global removeOnComplete', async () => {
      const keepJobs = 3;

      const newQueue = new Queue(queueName, {
        defaultJobOptions: {
          removeOnComplete: keepJobs,
        },
      });

      const worker = new Worker(queueName, async job => {
        await job.log('test log');
      });
      await worker.waitUntilReady();

      const datas = [0, 1, 2, 3, 4, 5, 6, 7, 8];

      const jobIds = await Promise.all(
        datas.map(async data => (await newQueue.append('test', data)).id),
      );

      return new Promise((resolve, reject) => {
        worker.on('completed', async job => {
          if (job.data == 8) {
            try {
              const counts = await newQueue.getJobCounts('completed');
              expect(counts.completed).to.be.equal(keepJobs);

              await Promise.all(
                jobIds.map(async (jobId, index) => {
                  const job = await newQueue.getJob(jobId);
                  if (index >= datas.length - keepJobs) {
                    expect(job).to.not.be.equal(null);
                  } else {
                    expect(job).to.be.equal(null);
                  }
                }),
              );
            } catch (err) {
              reject(err);
            } finally {
              worker.close();
              newQueue.close();
            }

            resolve();
          }
        });
      });
    });

    it('should remove job after failed if removeOnFail', async () => {
      const worker = new Worker(queueName, async job => {
        await job.log('test log');
        throw Error('error');
      });
      await worker.waitUntilReady();

      const job = await queue.append(
        'test',
        { foo: 'bar' },
        { removeOnFail: true },
      );
      expect(job.id).to.be.ok;
      expect(job.data.foo).to.be.eql('bar');

      return new Promise((resolve, reject) => {
        worker.on('failed', jobId => {
          queue
            .getJob(jobId)
            .then(job => {
              expect(job).to.be.equal(null);
              return null;
            })
            .then(() => {
              return queue.getJobCounts('failed').then(counts => {
                expect(counts.failed).to.be.equal(0);
                resolve();
              });
            });
        });
      });
    });

    it('should remove a job after fail if the default job options specify removeOnFail', async () => {
      const worker = new Worker(queueName, async job => {
        expect(job.data.foo).to.be.equal('bar');
        throw Error('error');
      });
      await worker.waitUntilReady();

      const newQueue = new Queue(queueName, {
        defaultJobOptions: {
          removeOnFail: true,
        },
      });

      const job = await newQueue.append('test', { foo: 'bar' });
      expect(job.id).to.be.ok;
      expect(job.data.foo).to.be.eql('bar');

      return new Promise((resolve, reject) => {
        worker.on('failed', async jobId => {
          const job = await newQueue.getJob(jobId);
          expect(job).to.be.equal(null);
          const counts = await newQueue.getJobCounts('completed');
          expect(counts.completed).to.be.equal(0);
          await worker.close();
          await newQueue.close();
          resolve();
        });
      });
    });

    it('should keep specified number of jobs after completed with removeOnFail', async () => {
      const keepJobs = 3;

      const worker = new Worker(queueName, async job => {
        throw Error('error');
      });
      await worker.waitUntilReady();

      const datas = [0, 1, 2, 3, 4, 5, 6, 7, 8];

      const jobIds = await Promise.all(
        datas.map(
          async data =>
            (await queue.append('test', data, { removeOnFail: keepJobs })).id,
        ),
      );

      return new Promise(resolve => {
        worker.on('failed', async job => {
          if (job.data == 8) {
            const counts = await queue.getJobCounts('failed');
            expect(counts.failed).to.be.equal(keepJobs);

            await Promise.all(
              jobIds.map(async (jobId, index) => {
                const job = await queue.getJob(jobId);
                if (index >= datas.length - keepJobs) {
                  expect(job).to.not.be.equal(null);
                } else {
                  expect(job).to.be.equal(null);
                }
              }),
            );
            await worker.close();
            resolve();
          }
        });
      });
    });

    it('should keep specified number of jobs after completed with global removeOnFail', async () => {
      const keepJobs = 3;

      const worker = new Worker(queueName, async job => {
        expect(job.data.foo).to.be.equal('bar');
        throw Error('error');
      });
      await worker.waitUntilReady();

      const newQueue = new Queue(queueName, {
        defaultJobOptions: {
          removeOnFail: keepJobs,
        },
      });

      const datas = [0, 1, 2, 3, 4, 5, 6, 7, 8];

      const jobIds = await Promise.all(
        datas.map(async data => (await newQueue.append('test', data)).id),
      );

      return new Promise((resolve, reject) => {
        worker.on('failed', async job => {
          if (job.data == 8) {
            try {
              const counts = await newQueue.getJobCounts('failed');
              expect(counts.failed).to.be.equal(keepJobs);

              await Promise.all(
                jobIds.map(async (jobId, index) => {
                  const job = await newQueue.getJob(jobId);
                  if (index >= datas.length - keepJobs) {
                    expect(job).to.not.be.equal(null);
                  } else {
                    expect(job).to.be.equal(null);
                  }
                }),
              );
            } catch (err) {
              reject(err);
            }
            await worker.close();
            await newQueue.close();
            resolve();
          }
        });
      });
    });
  });
});
