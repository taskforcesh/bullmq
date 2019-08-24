/*
describe('Cleaner', () => {
    let queue;

    beforeEach(() => {
      queue = utils.buildQueue('cleaner' + uuid());
    });

    afterEach(function() {
      this.timeout(
        queue.settings.stalledInterval * (1 + queue.settings.maxStalledCount)
      );
      return queue.close();
    });

    it('should reject the cleaner with no grace', done => {
      queue.clean().then(
        () => {
          done(new Error('Promise should not resolve'));
        },
        err => {
          expect(err).to.be.instanceof(Error);
          done();
        }
      );
    });

    it('should reject the cleaner an unknown type', done => {
      queue.clean(0, 'bad').then(
        () => {
          done(new Error('Promise should not resolve'));
        },
        e => {
          expect(e).to.be.instanceof(Error);
          done();
        }
      );
    });

    it('should clean an empty queue', done => {
      const testQueue = utils.buildQueue('cleaner' + uuid());
      testQueue.isReady().then(() => {
        return testQueue.clean(0);
      });
      testQueue.on('error', err => {
        utils.cleanupQueue(testQueue);
        done(err);
      });
      testQueue.on('cleaned', (jobs, type) => {
        expect(type).to.be.eql('completed');
        expect(jobs.length).to.be.eql(0);
        utils.cleanupQueue(testQueue);
        done();
      });
    });

    it('should clean two jobs from the queue', done => {
      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      queue.process((job, jobDone) => {
        jobDone();
      });

      queue.on(
        'completed',
        _.after(2, () => {
          queue.clean(0).then(jobs => {
            expect(jobs.length).to.be.eql(2);
            done();
          }, done);
        })
      );
    });

    it('should only remove a job outside of the grace period', done => {
      queue.process((job, jobDone) => {
        jobDone();
      });
      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      delay(200)
        .then(() => {
          queue.add({ some: 'data' });
          queue.clean(100);
          return null;
        })
        .then(() => {
          return delay(100);
        })
        .then(() => {
          return queue.getCompleted();
        })
        .then(jobs => {
          expect(jobs.length).to.be.eql(1);
          return queue.drain();
        })
        .then(() => {
          done();
        });
    });

    it('should clean all failed jobs', done => {
      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      queue.process((job, jobDone) => {
        jobDone(new Error('It failed'));
      });
      delay(100)
        .then(() => {
          return queue.clean(0, 'failed');
        })
        .then(jobs => {
          expect(jobs.length).to.be.eql(2);
          return queue.count();
        })
        .then(len => {
          expect(len).to.be.eql(0);
          done();
        });
    });

    it('should clean all waiting jobs', done => {
      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      delay(100)
        .then(() => {
          return queue.clean(0, 'wait');
        })
        .then(jobs => {
          expect(jobs.length).to.be.eql(2);
          return queue.count();
        })
        .then(len => {
          expect(len).to.be.eql(0);
          done();
        });
    });

    it('should clean all delayed jobs', done => {
      queue.add({ some: 'data' }, { delay: 5000 });
      queue.add({ some: 'data' }, { delay: 5000 });
      delay(100)
        .then(() => {
          return queue.clean(0, 'delayed');
        })
        .then(jobs => {
          expect(jobs.length).to.be.eql(2);
          return queue.count();
        })
        .then(len => {
          expect(len).to.be.eql(0);
          done();
        });
    });

    it('should clean the number of jobs requested', done => {
      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      delay(100)
        .then(() => {
          return queue.clean(0, 'wait', 1);
        })
        .then(jobs => {
          expect(jobs.length).to.be.eql(1);
          return queue.count();
        })
        .then(len => {
          expect(len).to.be.eql(2);
          done();
        });
    });

    it('should clean a job without a timestamp', done => {
      const client = new redis(6379, '127.0.0.1', {});

      queue.add({ some: 'data' });
      queue.add({ some: 'data' });
      queue.process((job, jobDone) => {
        jobDone(new Error('It failed'));
      });

      delay(100)
        .then(() => {
          return new Promise(resolve => {
            client.hdel('bull:' + queue.name + ':1', 'timestamp', resolve);
          });
        })
        .then(() => {
          return queue.clean(0, 'failed');
        })
        .then(jobs => {
          expect(jobs.length).to.be.eql(2);
          return queue.getFailed();
        })
        .then(failed => {
          expect(failed.length).to.be.eql(0);
          done();
        });
    });
  });
  */
