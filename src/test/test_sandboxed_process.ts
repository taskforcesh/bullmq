import { expect } from 'chai';
import IORedis from 'ioredis';
import _ from 'lodash';
import {Queue, QueueEvents, Worker} from "@src/classes";
import {beforeEach} from "mocha";
import {v4} from "node-uuid";
const delay = require('delay');
const pReflect = require('p-reflect');
const pool = require('../classes/child-pool').pool;

describe('sandboxed process', () => {
  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;
  let client: IORedis.Redis;

  beforeEach(() => {
    client = new IORedis();
    return client.flushdb();
  });

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
    queueEvents = new QueueEvents(queueName);
    return queueEvents.init();
  });

  afterEach(async () => {
    await queue.close();
    await queueEvents.close();
    await client.flushall();
    //pool.clean();
    return client.quit();
  });

  it('should process and complete', done => {
    const processFile = __dirname + '/fixtures/fixture_processor.js';

    const worker = new Worker(queueName, processFile, {
      drainDelay: 1,
      settings: {
        guardInterval: 300000,
        stalledInterval: 300000
      }
    });

    worker.on('completed', (job, value) => {
      try {
        expect(job.data).to.be.eql({ foo: 'bar' });
        expect(value).to.be.eql(42);
        expect(Object.keys(worker.childPool.retained)).to.have.lengthOf(0);
        expect(worker.childPool.free[processFile]).to.have.lengthOf(1);
        worker.close();
        done();
      } catch (err) {
        worker.close();
        done(err);
      }
    });

    queue.append('test',{ foo: 'bar' });
  });

  it('should process with named processor', done => {
    const processFile = __dirname + '/fixtures/fixture_processor.js';
    const worker = new Worker(queueName, processFile, {
      settings: {
        guardInterval: 300000,
        stalledInterval: 300000
      }
    });

    worker.on('completed', (job, value) => {
      try {
        expect(job.data).to.be.eql({ foo: 'bar' });
        expect(value).to.be.eql(42);
        expect(Object.keys(worker.childPool.retained)).to.have.lengthOf(0);
        expect(worker.childPool.free[processFile]).to.have.lengthOf(1);
        worker.close();
        done();
      } catch (err) {
        worker.close();
        done(err);
      }
    });

    queue.append('foobar', { foo: 'bar' });
  });

  // FIXME no named processors in 4.0
  // it('should process with several named processors', function(done) {
  //   this.timeout(10000);
  //
  //   const processFileFoo = __dirname + '/fixtures/fixture_processor_foo.js';
  //   const processFileBar = __dirname + '/fixtures/fixture_processor_bar.js';
  //
  //   const worker = new Worker(queueName, processFileFoo, {
  //     settings: {
  //       guardInterval: 300000,
  //       stalledInterval: 300000
  //     }
  //   });
  //
  //   let count = 0;
  //   worker.on('completed', (job, value) => {
  //     let data, result, processFile, retainedLength;
  //     count++;
  //     if (count == 1) {
  //       data = { foo: 'bar' };
  //       result = 'foo';
  //       processFile = processFileFoo;
  //       retainedLength = 1;
  //     } else {
  //       data = { bar: 'qux' };
  //       result = 'bar';
  //       processFile = processFileBar;
  //       retainedLength = 0;
  //     }
  //
  //     try {
  //       expect(job.data).to.be.eql(data);
  //       expect(value).to.be.eql(result);
  //       expect(Object.keys(workerFoo.childPool.retained)).to.have.lengthOf(
  //         retainedLength
  //       );
  //       expect(workerFoo.childPool.free[processFile]).to.have.lengthOf(1);
  //       if (count === 2) {
  //         done();
  //       }
  //     } catch (err) {
  //       console.error(err);
  //       done(err);
  //     }
  //   });
  //
  //   queue.append('foo', { foo: 'bar' }).then(() => {
  //     delay(500).then(() => {
  //       queue.append('bar', { bar: 'qux' });
  //     });
  //   });
  //
  //   worker.on('error', err => {
  //     console.error(err);
  //   });
  // });

  it('should process with concurrent processors', function(done) {
    let worker: Worker;

    const after = _.after(4, () => {
      expect(worker.childPool.getAllFree().length).to.eql(4);
      worker.close();
      done();
    });

    Promise.all([
      queue.append('test', { foo: 'bar1' }),
      queue.append('test',{ foo: 'bar2' }),
      queue.append('test',{ foo: 'bar3' }),
      queue.append('test',{ foo: 'bar4' })
    ]).then(() => {
      const processFile = __dirname + '/fixtures/fixture_processor_slow.js';
      worker = new Worker(queueName, processFile, {
        concurrency: 4,
        settings: {
          guardInterval: 300000,
          stalledInterval: 300000
        }
      });

      worker.on('completed', (job, value) => {
        try {
          expect(value).to.be.eql(42);
          expect(
              Object.keys(worker.childPool.retained).length +
              worker.childPool.getAllFree().length
          ).to.eql(4);
          after();
        } catch (err) {
          worker.close();
          console.log("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<");
          done(err);
        }
      });
    });
  });

  it('should reuse process with single processors', function(done) {
    this.timeout(30000);

    let worker: Worker;
    const processFile = __dirname + '/fixtures/fixture_processor_slow.js';
    worker = new Worker(queueName, processFile, {
      concurrency: 1,
      settings: {
        guardInterval: 300000,
        stalledInterval: 300000
      }
    });

    const after = _.after(4, () => {
      expect(worker.childPool.getAllFree().length).to.eql(1);
      worker.close();
      done();
    });

    Promise.all([
      queue.append('1', { foo: 'bar1' }),
      queue.append('2',{ foo: 'bar2' }),
      queue.append('3',{ foo: 'bar3' }),
      queue.append('4',{ foo: 'bar4' })
    ]).then(() => {
      worker.on('completed', (job, value) => {
        try {
          expect(value).to.be.eql(42);
          expect(
              Object.keys(worker.childPool.retained).length +
              worker.childPool.getAllFree().length
          ).to.eql(1);
          after();
        } catch (err) {
          worker.close();
          done(err);
        }
      });
    });
  });

  // FIXME no done() in 4.0
  // it('should process and complete using done', done => {
  //   const processFile = __dirname + '/fixtures/fixture_processor_callback.js';
  //
  //   const worker = new Worker(queueName, processFile, {
  //     settings: {
  //       guardInterval: 300000,
  //       stalledInterval: 300000
  //     }
  //   });
  //
  //   worker.on('completed', (job, value) => {
  //     try {
  //       expect(job.data).to.be.eql({ foo: 'bar' });
  //       expect(value).to.be.eql(42);
  //       expect(Object.keys(worker.childPool.retained)).to.have.lengthOf(0);
  //       expect(worker.childPool.getAllFree()).to.have.lengthOf(1);
  //       done();
  //     } catch (err) {
  //       done(err);
  //     }
  //   });
  //
  //   queue.append('test', { foo: 'bar' });
  // });

  it('should process and update progress', done => {

    const processFile = __dirname + '/fixtures/fixture_processor_progress.js';

    const worker = new Worker(queueName, processFile, {
      settings: {
        guardInterval: 300000,
        stalledInterval: 300000
      }
    });

    const progresses: any[] = [];

    worker.on('completed', (job, value) => {
      try {
        expect(job.data).to.be.eql({ foo: 'bar' });
        expect(value).to.be.eql(37);
        expect(job.progress).to.be.eql(100);
        expect(progresses).to.be.eql([10, 27, 78, 100]);
        expect(Object.keys(worker.childPool.retained)).to.have.lengthOf(0);
        expect(worker.childPool.getAllFree()).to.have.lengthOf(1);
        worker.close();
        done();
      } catch (err) {
        worker.close();
        done(err);
      }
    });


    worker.on('progress', (job, progress) => {
      progresses.push(progress);
    });

    queue.append('test', { foo: 'bar' });
  });

  it('should process and fail', done => {
    const processFile = __dirname + '/fixtures/fixture_processor_fail.js';

    const worker = new Worker(queueName, processFile, {
      settings: {
        guardInterval: 300000,
        stalledInterval: 300000
      }
    });

    worker.on('failed', (job, err) => {
      try {
        expect(job.data).eql({ foo: 'bar' });
        expect(job.failedReason).eql('Manually failed processor');
        expect(err.message).eql('Manually failed processor');
        expect(err.stack).include('fixture_processor_fail.js');
        expect(Object.keys(worker.childPool.retained)).to.have.lengthOf(0);
        expect(worker.childPool.getAllFree()).to.have.lengthOf(1);
        worker.close();
        done();
      } catch (err) {
        worker.close();
        done(err);
      }
    });

    queue.append('test', { foo: 'bar' });
  });

  it('should error if processor file is missing', done => {

    let worker;
    try {
      const missingProcessFile = __dirname + '/fixtures/missing_processor.js';
      worker = new Worker(queueName, missingProcessFile, {});
      worker.close();
      done(new Error('did not throw error'));
    } catch (err) {
      worker && worker.close();
      done();
    }
  });

  // FIXME no done() in 4.0
  // it('should process and fail using callback', done => {
  //   const processFile = __dirname + '/fixtures/fixture_processor_callback_fail.js';
  //
  //   const worker = new Worker(queueName, processFile, {
  //     settings: {
  //       guardInterval: 300000,
  //       stalledInterval: 300000
  //     }
  //   });
  //
  //   worker.on('failed', (job, err) => {
  //     try {
  //       expect(job.data).eql({ foo: 'bar' });
  //       expect(job.failedReason).eql('Manually failed processor');
  //       expect(err.message).eql('Manually failed processor');
  //       expect(Object.keys(worker.childPool.retained)).to.have.lengthOf(0);
  //       expect(worker.childPool.getAllFree()).to.have.lengthOf(1);
  //       done();
  //     } catch (err) {
  //       done(err);
  //     }
  //   });
  //
  //   queue.append('test', { foo: 'bar' });
  // });

  it('should fail if the process crashes', () => {

    const processFile = __dirname + '/fixtures/fixture_processor_crash.js';

    const worker = new Worker(queueName, processFile, {
      settings: {
        guardInterval: 300000,
        stalledInterval: 300000
      }
    });

    return queue
      .append('test', {})
      .then(job => {
        return pReflect(Promise.resolve(job.waitUntilFinished(queueEvents)));
      })
      .then(inspection => {
        expect(inspection.isRejected).to.be.eql(true);
        expect(inspection.reason.message).to.be.eql('boom!');
      });
  });

  it('should fail if the process exits 0', () => {
    const processFile = __dirname + '/fixtures/fixture_processor_crash.js';

    const worker = new Worker(queueName, processFile, {
      settings: {
        guardInterval: 300000,
        stalledInterval: 300000
      }
    });

    return queue
      .append('test', { exitCode: 0 })
      .then(job => {
        return pReflect(Promise.resolve(job.waitUntilFinished(queueEvents)));
      })
      .then(inspection => {
        expect(inspection.isRejected).to.be.eql(true);
        expect(inspection.reason.message).to.be.eql(
          'Unexpected exit code: 0 signal: null'
        );
      });
  });

  it('should fail if the process exits non-0', () => {
    const processFile = __dirname + '/fixtures/fixture_processor_crash.js';

    const worker = new Worker(queueName, processFile, {
      settings: {
        guardInterval: 300000,
        stalledInterval: 300000
      }
    });

    return queue
      .append('test', { exitCode: 1 })
      .then(job => {
        return pReflect(Promise.resolve(job.waitUntilFinished(queueEvents)));
      })
      .then(inspection => {
        expect(inspection.isRejected).to.be.eql(true);
        expect(inspection.reason.message).to.be.eql(
          'Unexpected exit code: 1 signal: null'
        );
      });
  });

  it('should remove exited process', done => {
    const processFile = __dirname + '/fixtures/fixture_processor_exit.js';

    const worker = new Worker(queueName, processFile, {
      settings: {
        guardInterval: 300000,
        stalledInterval: 300000
      }
    });

    worker.on('completed', () => {
      try {
        expect(Object.keys(worker.childPool.retained)).to.have.lengthOf(0);
        expect(worker.childPool.getAllFree()).to.have.lengthOf(1);
        delay(500)
          .then(() => {
            expect(Object.keys(worker.childPool.retained)).to.have.lengthOf(0);
            expect(worker.childPool.getAllFree()).to.have.lengthOf(0);
          })
          .then(() => {
            done();
          }, done);
      } catch (err) {
        done(err);
      }
    });

    queue.append('test', { foo: 'bar' });
  });
});
