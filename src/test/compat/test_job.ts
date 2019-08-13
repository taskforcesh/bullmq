import { Queue3 as Queue, Job3 as Job, JobId3 as JobId, JobStatus3 as JobStatus, QueueOptions3 as QueueOptions, JobOptions3 as JobOptions } from '@src/classes/compat';
import _ from 'lodash';
import IORedis from 'ioredis';
import { expect } from 'chai';
import sinon from 'sinon';
import { v4 as uuid } from 'node-uuid';
import * as utils from './utils';
import { Scripts } from '@src/classes/scripts';

describe('Job', () => {
  let queue: Queue;
  let client: IORedis.Redis;

  beforeEach(() => {
    client = new IORedis();
    return client.flushdb();
  });

  beforeEach(() => {
    queue = new Queue('test-' + uuid(), {
      redis: { port: 6379, host: '127.0.0.1' }
    });
  });

  afterEach(function() {
    this.timeout(
      queue['settings'].stalledInterval * (1 + queue['settings'].maxStalledCount)
    );
    return queue.close().then(() => {
      return client.quit();
    });
  });

  describe('.create', () => {
    let job: Job;
    let data: any;
    let opts: JobOptions;

    beforeEach(() => {
      data = { foo: 'bar' };
      opts = { testOpt: 'enabled' } as any;

      return Job.create(queue, data, opts).then(createdJob => {
        job = createdJob;
      });
    });

    it('returns a promise for the job', () => {
      expect(job).to.have.property('id');
      expect(job).to.have.property('data');
    });

    it('should not modify input options', () => {
      expect(opts).not.to.have.property('jobId');
    });

    // TODO arbitrary job opts not converted
    // it('saves the job in redis', () => {
    //   return Job.fromId(queue, job.id).then(storedJob => {
    //     expect(storedJob).to.have.property('id');
    //     expect(storedJob).to.have.property('data');
    //
    //     expect(storedJob.data.foo).to.be.equal('bar');
    //     //expect(storedJob.opts).to.be.a(Object as any);
    //     expect((storedJob.opts as any).testOpt).to.be.equal('enabled');
    //   });
    // });

    it('should use the custom jobId if one is provided', () => {
      const customJobId = 'customjob';
      return Job.create(queue, data, { jobId: customJobId }).then(
        createdJob => {
          expect(createdJob.id).to.be.equal(customJobId);
        }
      );
    });

    it('should process jobs with custom jobIds', done => {
      const customJobId = 'customjob';
      queue.process(() => {
        return Promise.resolve();
      });

      queue.add({ foo: 'bar' }, { jobId: customJobId });

      queue.on('completed', job => {
        if (job.id == customJobId) {
          done();
        }
      });
    });
  });

  describe('.add jobs on priority queues', () => {
    it('add 4 jobs with different priorities', () => {
      return queue
        .add({ foo: 'bar' }, { jobId: '1', priority: 3 })
        .then(() => {
          return queue.add({ foo: 'bar' }, { jobId: '2', priority: 3 });
        })
        .then(() => {
          return queue.add({ foo: 'bar' }, { jobId: '3', priority: 2 });
        })
        .then(() => {
          return queue.add({ foo: 'bar' }, { jobId: '4', priority: 1 });
        })
        .then(() => {
          return queue
            .getWaiting()
            .then(result => {
              const waitingIDs: JobId[] = [];
              result.forEach(element => {
                waitingIDs.push(element.id);
              });
              return waitingIDs;
            })
            .then(waitingIDs => {
              expect(waitingIDs.length).to.be.equal(4);
              expect(waitingIDs).to.be.eql(['4', '3', '1', '2']);
            });
        });
    });
  });

  describe('.update', () => {
    it('should allow updating job data', () => {
      return Job.create(queue, { foo: 'bar' })
        .then(job => {
          return job.update({ baz: 'qux' }).then(() => {
            return job;
          });
        })
        .then(job => {
          return Job.fromId(queue, job.id).then(job => {
            expect(job.data).to.be.eql({ baz: 'qux' });
          });
        });
    });
  });

  describe('.remove', () => {
    it('removes the job from redis', () => {
      return Job.create(queue, { foo: 'bar' })
        .then(job => {
          return job.remove().then(() => {
            return job;
          });
        })
        .then(job => {
          return Job.fromId(queue, job.id);
        })
        .then(storedJob => {
          expect(storedJob).to.be.equal(null);
        });
    });

    // TODO not supported
    // it('fails to remove a locked job', () => {
    //   return Job.create(queue, 1, { foo: 'bar' }).then(job => {
    //     return job
    //       .takeLock()
    //       .then(lock => {
    //         expect(lock).to.be.ok;
    //       })
    //       .then(() => {
    //         return Job.fromId(queue, job.id).then(job => {
    //           return job.remove();
    //         });
    //       })
    //       .then(() => {
    //         throw new Error('Should not be able to remove a locked job');
    //       })
    //       .catch((/*err*/) => {
    //         // Good!
    //       });
    //   });
    // });

    // TODO not supported
    // it('removes any job from active set', () => {
    //   return queue.add({ foo: 'bar' }).then(job => {
    //     // Simulate a job in active state but not locked
    //     return queue
    //       .getNextJob()
    //       .then(() => {
    //         return job
    //           .isActive()
    //           .then(isActive => {
    //             expect(isActive).to.be.equal(true);
    //             return job.releaseLock();
    //           })
    //           .then(() => {
    //             return job.remove();
    //           });
    //       })
    //       .then(() => {
    //         return Job.fromId(queue, job.id);
    //       })
    //       .then((stored: Job) => {
    //         expect(stored).to.be.equal(null);
    //         return job.getState();
    //       })
    //       .then((state: JobStatus) => {
    //         // This check is a bit of a hack. A job that is not found in any list will return the state
    //         // stuck.
    //         expect(state).to.be.equal('stuck');
    //       });
    //   });
    // });

    // TODO not supported
    // it('emits removed event', cb => {
    //   queue.once('removed', job => {
    //     expect(job.data.foo).to.be.equal('bar');
    //     cb();
    //   });
    //   Job.create(queue, { foo: 'bar' }).then(job => {
    //     job.remove();
    //   });
    // });

    it('a succesful job should be removable', done => {
      queue.process(() => {
        return Promise.resolve();
      });

      queue.add({ foo: 'bar' });

      queue.on('completed', job => {
        job
          .remove()
          .then(done)
          .catch(done);
      });
    });

    it('a failed job should be removable', done => {
      queue.process(() => {
        throw new Error();
      });

      queue.add({ foo: 'bar' });

      queue.on('failed', job => {
        job
          .remove()
          .then(done)
          .catch(done);
      });
    });
  });

  describe('.remove on priority queues', () => {
    it('remove a job with jobID 1 and priority 3 and check the new order in the queue', () => {
      return queue
        .add({ foo: 'bar' }, { jobId: '1', priority: 3 })
        .then(() => {
          return queue.add({ foo: 'bar' }, { jobId: '2', priority: 3 });
        })
        .then(() => {
          return queue.add({ foo: 'bar' }, { jobId: '3', priority: 2 });
        })
        .then(() => {
          return queue.add({ foo: 'bar' }, { jobId: '4', priority: 1 });
        })
        .then(() => {
          return queue.getJob('1').then(job => {
            return job.remove().then(() => {
              return queue
                .getWaiting()
                .then(result => {
                  const waitingIDs: JobId[] = [];
                  result.forEach(element => {
                    waitingIDs.push(element.id);
                  });
                  return waitingIDs;
                })
                .then(waitingIDs => {
                  expect(waitingIDs.length).to.be.equal(3);
                  expect(waitingIDs).to.be.eql(['4', '3', '2']);
                });
            });
          });
        });
    });

    it('add a new job with priority 10 and ID 5 and check the new order (along with the previous 4 jobs)', () => {
      return queue
        .add({ foo: 'bar' }, { jobId: '1', priority: 3 })
        .then(() => {
          return queue.add({ foo: 'bar' }, { jobId: '2', priority: 3 });
        })
        .then(() => {
          return queue.add({ foo: 'bar' }, { jobId: '3', priority: 2 });
        })
        .then(() => {
          return queue.add({ foo: 'bar' }, { jobId: '4', priority: 1 });
        })
        .then(() => {
          return queue.getJob('1').then(job => {
            return job.remove().then(() => {
              return queue
                .getWaiting()
                .then(result => {
                  const waitingIDs: JobId[] = [];
                  result.forEach(element => {
                    waitingIDs.push(element.id);
                  });
                  return waitingIDs;
                })
                .then(waitingIDs => {
                  expect(waitingIDs.length).to.be.equal(3);
                  expect(waitingIDs).to.be.eql(['4', '3', '2']);
                  return true;
                })
                .then(() => {
                  return queue
                    .add({ foo: 'bar' }, { jobId: '5', priority: 10 })
                    .then(() => {
                      return queue
                        .getWaiting()
                        .then(result => {
                          const waitingIDs: JobId[] = [];
                          result.forEach(element => {
                            waitingIDs.push(element.id);
                          });
                          return waitingIDs;
                        })
                        .then(waitingIDs => {
                          expect(waitingIDs.length).to.be.equal(4);
                          expect(waitingIDs).to.be.eql(['4', '3', '2', '5']);
                        });
                    });
                });
            });
          });
        });
    });
  });

  // TODO timeout
  // describe('.retry', () => {
  //   it('emits waiting event', cb => {
  //     queue.add({ foo: 'bar' });
  //     queue.process((job, done) => {
  //       done(new Error('the job failed'));
  //     });
  //
  //     queue.once('failed', job => {
  //       queue.once('global:waiting', jobId2 => {
  //         Job.fromId(queue, jobId2).then(job2 => {
  //           expect(job2.data.foo).to.be.equal('bar');
  //           cb();
  //         });
  //       });
  //       queue.once('registered:global:waiting', () => {
  //         job.retry();
  //       });
  //     });
  //   });
  // });

  describe('Locking', () => {
    let job: Job;

    beforeEach(() => {
      return Job.create(queue, { foo: 'bar' }).then(createdJob => {
        job = createdJob;
      });
    });

    // TODO not supported
    // it('can take a lock', () => {
    //   return job
    //     .takeLock()
    //     .then(lockTaken => {
    //       expect(lockTaken).to.be.ok;
    //     })
    //     .then(() => {
    //       return job.releaseLock().then(lockReleased => {
    //         expect(lockReleased).to.not.exist;
    //       });
    //     });
    // });

    // TODO not supported
    // it('take an already taken lock', () => {
    //   return job
    //     .takeLock()
    //     .then(lockTaken => {
    //       expect(lockTaken).to.be.ok;
    //     })
    //     .then(() => {
    //       return job.takeLock().then(lockTaken => {
    //         expect(lockTaken).to.be.ok;
    //       });
    //     });
    // });

    // TODO not supported
    // it('can release a lock', () => {
    //   return job
    //     .takeLock()
    //     .then(lockTaken => {
    //       expect(lockTaken).to.be.ok;
    //     })
    //     .then(() => {
    //       return job.releaseLock().then(lockReleased => {
    //         expect(lockReleased).to.not.exist;
    //       });
    //     });
    // });
  });

  describe('.progress', () => {
    it('can set and get progress as number', () => {
      return Job.create(queue, { foo: 'bar' }).then(job => {
        return job.progress(42).then(() => {
          return Job.fromId(queue, job.id).then(storedJob => {
            expect(storedJob.progress()).to.be.equal(42);
          });
        });
      });
    });
    it('can set and get progress as object', () => {
      return Job.create(queue, { foo: 'bar' }).then(job => {
        return job.progress({ total: 120, completed: 40 }).then(() => {
          return Job.fromId(queue, job.id).then(storedJob => {
            expect(storedJob.progress()).to.be.eql({ total: 120, completed: 40 });
          });
        });
      });
    });
  });

  // TODO not supported
  // describe('.log', () => {
  //   it('can log two rows with text', () => {
  //     const firstLog = 'some log text 1';
  //     const secondLog = 'some log text 2';
  //     return Job.create(queue, { foo: 'bar' }).then(job =>
  //       job
  //         .log(firstLog)
  //         .then(() => job.log(secondLog))
  //         .then(() => queue.getJobLogs(job.id))
  //         .then(logs =>
  //           expect(logs).to.be.equal({ logs: [firstLog, secondLog], count: 2 })
  //         )
  //         .then(() => job.remove())
  //         .then(() => queue.getJobLogs(job.id))
  //         .then(logs => expect(logs).to.be.equal({ logs: [], count: 0 }))
  //     );
  //   });
  // });

  describe('.moveToCompleted', () => {
    it('marks the job as completed and returns new job', () => {
      return Job.create(queue, { foo: 'bar' }).then(job1 => {
        return Job.create(queue, { foo: 'bar' }).then(job2 => {
          return job2
            .isCompleted()
            .then(isCompleted => {
              expect(isCompleted).to.be.equal(false);
            })
            .then(() => {
              return job2.moveToCompleted('succeeded', true);
            })
            .then(job1Id => {
              return job2.isCompleted().then(isCompleted => {
                expect(isCompleted).to.be.equal(true);
                expect(job2.returnvalue).to.be.equal('succeeded');
                expect(job1Id[1]).to.be.equal(job1.id);
              });
            });
        });
      });
    });
  });

  describe('.moveToFailed', () => {
    it('marks the job as failed', () => {
      return Job.create(queue, { foo: 'bar' }).then(job => {
        return job
          .isFailed()
          .then(isFailed => {
            expect(isFailed).to.be.equal(false);
          })
          .then(() => {
            return job.moveToFailed(new Error('test error'), true);
          })
          .then(() => {
            return job.isFailed().then(isFailed => {
              expect(isFailed).to.be.equal(true);
              expect(job.stacktrace).to.not.be.null;
              expect(job.stacktrace.length).to.be.equal(1);
            });
          });
      });
    });

    it('moves the job to wait for retry if attempts are given', () => {
      return Job.create(queue, { foo: 'bar' }, { attempts: 3 }).then(job => {
        return job
          .isFailed()
          .then(isFailed => {
            expect(isFailed).to.be.false;
          })
          .then(() => {
            return job.moveToFailed(new Error('test error'), true);
          })
          .then(() => {
            return job.isFailed().then(isFailed => {
              expect(isFailed).to.be.false;
              expect(job.stacktrace).not.be.null;
              expect(job.stacktrace.length).to.be.equal(1);
              return job.isWaiting().then(isWaiting => {
                expect(isWaiting).to.be.equal(true);
              });
            });
          });
      });
    });

    it('marks the job as failed when attempts made equal to attempts given', () => {
      return Job.create(queue, { foo: 'bar' }, { attempts: 1 }).then(job => {
        return job
          .isFailed()
          .then(isFailed => {
            expect(isFailed).to.be.equal(false);
          })
          .then(() => {
            return job.moveToFailed(new Error('test error'), true);
          })
          .then(() => {
            return job.isFailed().then(isFailed => {
              expect(isFailed).to.be.equal(true);
              expect(job.stacktrace).to.not.be.equal(null);
              expect(job.stacktrace.length).to.be.equal(1);
            });
          });
      });
    });

    it('moves the job to delayed for retry if attempts are given and backoff is non zero', () => {
      return Job.create(
        queue,
        { foo: 'bar' },
        { attempts: 3, backoff: 300 }
      ).then(job => {
        return job
          .isFailed()
          .then(isFailed => {
            expect(isFailed).to.be.equal(false);
          })
          .then(() => {
            return job.moveToFailed(new Error('test error'), true);
          })
          .then(() => {
            return job.isFailed().then(isFailed => {
              expect(isFailed).to.be.equal(false);
              expect(job.stacktrace).not.be.null;
              expect(job.stacktrace.length).to.be.equal(1);
              return job.isDelayed().then(isDelayed => {
                expect(isDelayed).to.be.equal(true);
              });
            });
          });
      });
    });

    it('applies stacktrace limit on failure', () => {
      const stackTraceLimit = 1;
      return Job.create(queue, { foo: 'bar' }, { stackTraceLimit }).then(
        job => {
          return job
            .isFailed()
            .then(isFailed => {
              expect(isFailed).to.be.equal(false);
            })
            .then(() => {
              return job.moveToFailed(new Error('test error'), true);
            })
            .then(() => {
              return job
                .moveToFailed(new Error('test error'), true)
                .then(() => {
                  return job.isFailed().then(isFailed => {
                    expect(isFailed).to.be.equal(true);
                    expect(job.stacktrace).not.be.null;
                    expect(job.stacktrace.length).to.be.equal(stackTraceLimit);
                  });
                });
            });
        }
      );
    });
  });

  describe('.promote', () => {
    // TODO not supported
    // it('can promote a delayed job to be executed immediately', () => {
    //   return Job.create(queue, { foo: 'bar' }, { delay: 1500 }).then(job => {
    //     return job
    //       .isDelayed()
    //       .then(isDelayed => {
    //         expect(isDelayed).to.be.equal(true);
    //       })
    //       .then(() => {
    //         return job.promote();
    //       })
    //       .then(() => {
    //         return job.isDelayed().then(isDelayed => {
    //           expect(isDelayed).to.be.equal(false);
    //           return job.isWaiting().then(isWaiting => {
    //             expect(isWaiting).to.be.equal(true);
    //             return;
    //           });
    //         });
    //       });
    //   });
    // });

    // TODO not supported
    // it('should process a promoted job according to its priority', done => {
    //   queue.process(() => {
    //     return utils.sleep(100);
    //   });
    //
    //   const completed: JobId[] = [];
    //
    //   queue.on('completed', job => {
    //     completed.push(job.id);
    //     if (completed.length > 3) {
    //       expect(completed).to.be.equal(['1', '2', '3', '4']);
    //       done();
    //     }
    //   });
    //   const processStarted = new Promise(resolve =>
    //     queue.once('active', resolve)
    //   );
    //
    //   const add = (id: string, ms?: number) =>
    //     queue.add({}, { jobId: id, delay: ms, priority: 1 });
    //
    //   add('1')
    //     .then(() => add('2', 1))
    //     .then(() => processStarted)
    //     .then(() => add('3', 5000))
    //     .then(job => {
    //       job.promote();
    //     })
    //     .then(() => add('4', 1));
    // });

    // TODO not supported
    // it('should not promote a job that is not delayed', () => {
    //   return Job.create(queue, { foo: 'bar' }).then(job => {
    //     return job
    //       .isDelayed()
    //       .then(isDelayed => {
    //         expect(isDelayed).to.be.equal(false);
    //       })
    //       .then(() => {
    //         return job.promote();
    //       })
    //       .then(() => {
    //         throw new Error('Job should not be promoted!');
    //       })
    //       .catch(err => {
    //         expect(err).to.be.ok;
    //       });
    //   });
    // });
  });

  // TODO:
  // Divide into several tests
  //

  // TODO isStuck not supported
  // it('get job status', function() {
  //   this.timeout(12000);
  //
  //   const client = new IORedis();
  //   return Job.create(queue, { foo: 'baz' })
  //     .then(job => {
  //       return job
  //         .isStuck()
  //         .then(isStuck => {
  //           expect(isStuck).to.be.equal(false);
  //           return job.getState();
  //         })
  //         .then(state => {
  //           expect(state).to.be.equal('waiting');
  //           return Scripts.moveToActive((queue as any).getWorker(), undefined).then(() => {
  //             return job.moveToCompleted();
  //           });
  //         })
  //         .then(() => {
  //           return job.isCompleted();
  //         })
  //         .then(isCompleted => {
  //           expect(isCompleted).to.be.equal(true);
  //           return job.getState();
  //         })
  //         .then(state => {
  //           expect(state).to.be.equal('completed');
  //           return client.zrem(queue.toKey('completed'), job.id);
  //         })
  //         .then(() => {
  //           return job.moveToDelayed(Date.now() + 10000, true);
  //         })
  //         .then(() => {
  //           return job.isDelayed();
  //         })
  //         .then(yes => {
  //           expect(yes).to.be.equal(true);
  //           return job.getState();
  //         })
  //         .then(state => {
  //           expect(state).to.be.equal('delayed');
  //           return client.zrem(queue.toKey('delayed'), job.id);
  //         })
  //         .then(() => {
  //           return job.moveToFailed(new Error('test'), true);
  //         })
  //         .then(() => {
  //           return job.isFailed();
  //         })
  //         .then(isFailed => {
  //           expect(isFailed).to.be.equal(true);
  //           return job.getState();
  //         })
  //         .then(state => {
  //           expect(state).to.be.equal('failed');
  //           return client.zrem(queue.toKey('failed'), job.id);
  //         })
  //         .then(res => {
  //           expect(res).to.be.equal(1);
  //           return job.getState();
  //         })
  //         .then(state => {
  //           expect(state).to.be.equal('stuck');
  //           return client.rpop(queue.toKey('wait'));
  //         })
  //         .then(() => {
  //           return client.lpush(queue.toKey('paused'), job.id);
  //         })
  //         .then(() => {
  //           return job.isPaused();
  //         })
  //         .then(isPaused => {
  //           expect(isPaused).to.be.equal(true);
  //           return job.getState();
  //         })
  //         .then(state => {
  //           expect(state).to.be.equal('paused');
  //           return client.rpop(queue.toKey('paused'));
  //         })
  //         .then(() => {
  //           return client.lpush(queue.toKey('wait'), job.id);
  //         })
  //         .then(() => {
  //           return job.isWaiting();
  //         })
  //         .then(isWaiting => {
  //           expect(isWaiting).to.be.equal(true);
  //           return job.getState();
  //         })
  //         .then(state => {
  //           expect(state).to.be.equal('waiting');
  //         });
  //     })
  //     .then(() => {
  //       return client.quit();
  //     });
  // });

  describe('.finished', () => {
    // TODO timeout
    // it('should resolve when the job has been completed', done => {
    //   queue.process(() => {
    //     return utils.sleep(500);
    //   });
    //   queue
    //     .add({ foo: 'bar' })
    //     .then(job => {
    //       return job.finished();
    //     })
    //     .then(done, done);
    // });

    // TODO
    // it('should resolve when the job has been completed and return object', done => {
    //   queue.process((/*job*/) => {
    //     return utils.sleep(500).then(() => {
    //       return { resultFoo: 'bar' };
    //     });
    //   });
    //   queue
    //     .add({ foo: 'bar' })
    //     .then(job => {
    //       return job.finished();
    //     })
    //     .then(jobResult => {
    //       expect(jobResult).to.be.an('object');
    //       expect(jobResult.resultFoo).equal('bar');
    //       done();
    //     });
    // });

    it('should resolve when the job has been delayed and completed and return object', done => {
      queue.process((/*job*/) => {
        return utils.sleep(300).then(() => {
          return { resultFoo: 'bar' };
        });
      });
      queue
        .add({ foo: 'bar' })
        .then(job => {
          return utils.sleep(600).then(() => {
            return job.finished();
          });
        })
        .then(jobResult => {
          expect(jobResult).to.be.an('object');
          expect(jobResult.resultFoo).equal('bar');
          done();
        });
    });

    it('should resolve when the job has been completed and return string', done => {
      queue.process((/*job*/) => {
        return utils.sleep(500).then(() => {
          return 'a string';
        });
      });
      queue
        .add({ foo: 'bar' })
        .then(job => {
          return utils.sleep(600).then(() => {
            return job.finished();
          });
        })
        .then(jobResult => {
          expect(jobResult).to.be.an('string');
          expect(jobResult).equal('a string');
          done();
        });
    });

    // TODO
    // it('should resolve when the job has been delayed and completed and return string', done => {
    //   queue.process((/*job*/) => {
    //     return utils.sleep(300).then(() => {
    //       return 'a string';
    //     });
    //   });
    //   queue
    //     .add({ foo: 'bar' })
    //     .then(job => {
    //       return job.finished();
    //     })
    //     .then(jobResult => {
    //       expect(jobResult).to.be.an('string');
    //       expect(jobResult).equal('a string');
    //       done();
    //     });
    // });

    // TODO
    // it('should reject when the job has been failed', done => {
    //   queue.process(() => {
    //     return utils.sleep(500).then(() => {
    //       return Promise.reject(new Error('test error'));
    //     });
    //   });
    //
    //   queue
    //     .add({ foo: 'bar' })
    //     .then(job => {
    //       return job.finished();
    //     })
    //     .then(
    //       () => {
    //         done(Error('should have been rejected'));
    //       },
    //       err => {
    //         expect(err.message).equal('test error');
    //         done();
    //       }
    //     );
    // });

    it('should resolve directly if already processed', done => {
      queue.process(() => {
        return Promise.resolve();
      });
      queue
        .add({ foo: 'bar' })
        .then(job => {
          return utils.sleep(500).then(() => {
            return job.finished();
          });
        })
        .then(() => {
          done();
        }, done);
    });

    it('should reject directly if already processed', done => {
      queue.process(() => {
        return Promise.reject(Error('test error'));
      });
      queue
        .add({ foo: 'bar' })
        .then(job => {
          return utils.sleep(500).then(() => {
            return job.finished();
          });
        })
        .then(
          () => {
            done(Error('should have been rejected'));
          },
          err => {
            expect(err.message).equal('test error');
            done();
          }
        );
    });
  });
});
