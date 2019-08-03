/**
 * Master of child processes. Handles communication between the
 * processor and the main process.
 *
 */

let status;
let processor;

const util = require('util');

// https://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify
if (!('toJSON' in Error.prototype)) {
  Object.defineProperty(Error.prototype, 'toJSON', {
    value: function() {
      const alt = {};
      const _this = this;

      Object.getOwnPropertyNames(_this).forEach(function(key) {
        alt[key] = _this[key];
      }, this);

      return alt;
    },
    configurable: true,
    writable: true,
  });
}

process.on('message', msg => {
  switch (msg.cmd) {
    case 'init':
      processor = require(msg.value);
      if (processor.default) {
        // support es2015 module.
        processor = processor.default;
      }
      if (processor.length > 1) {
        processor = util.promisify(processor);
      } else {
        const origProcessor = processor;
        processor = function() {
          try {
            return Promise.resolve(origProcessor.apply(null, arguments));
          } catch (err) {
            return Promise.reject(err);
          }
        };
      }
      status = 'IDLE';
      break;

    case 'start':
      if (status !== 'IDLE') {
        return process.send({
          cmd: 'error',
          err: new Error('cannot start a not idling child process'),
        });
      }
      status = 'STARTED';

      Promise.resolve(processor(wrapJob(msg.job)) || {})
        .then(
          result => {
            process.send({
              cmd: 'completed',
              value: result,
            });
          },
          err => {
            if (!err.message) {
              err = new Error(err);
            }
            process.send({
              cmd: 'failed',
              value: err,
            });
          },
        )
        .finally(() => {
          status = 'IDLE';
        });
      break;
    case 'stop':
      break;
  }
});

process.on('uncaughtException', err => {
  if (!err.message) {
    err = new Error(_.toString(err));
  }
  process.send({
    cmd: 'failed',
    value: err,
  });
  throw err;
});

function wrapJob(job) {
  job.data = JSON.parse(job.data || '{}');
  job.opts = JSON.parse(job.opts || '{}');

  job.progress = function(progress) {
    process.send({
      cmd: 'progress',
      value: progress,
    });
    return Promise.resolve();
  };
  job.log = function(row) {
    process.send({
      cmd: 'log',
      value: row,
    });
  };
  return job;
}
