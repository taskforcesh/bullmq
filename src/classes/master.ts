/**
 * Master of child processes. Handles communication between the
 * processor and the main process.
 *
 */
import { promisify } from 'util';
import _ from 'lodash';

let status: any;
let processor: any;

// https://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify
if (!('toJSON' in Error.prototype)) {
  Object.defineProperty(Error.prototype, 'toJSON', {
    value: function() {
      const alt: any = {};
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

process.on('message', async msg => {
  switch (msg.cmd) {
    case 'init':
      processor = require(msg.value);
      if (processor.default) {
        // support es2015 module.
        processor = processor.default;
      }
      if (processor.length > 1) {
        processor = promisify(processor);
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
      try {
        const result = await Promise.resolve(processor(wrapJob(msg.job)) || {});
        process.send({
          cmd: 'completed',
          value: result,
        });
      } catch (err) {
        if (!err.message) {
          err = new Error(err);
        }
        process.send({
          cmd: 'failed',
          value: err,
        });
      } finally {
        status = 'IDLE';
      }
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

function wrapJob(job: any) {
  job.data = JSON.parse(job.data || '{}');
  job.opts = JSON.parse(job.opts || '{}');

  job.progress = function(progress: any) {
    process.send({
      cmd: 'progress',
      value: progress,
    });
    return Promise.resolve();
  };
  job.log = function(row: any) {
    process.send({
      cmd: 'log',
      value: row,
    });
  };
  return job;
}
