/**
 * Master of child processes. Handles communication between the
 * processor and the main process.
 *
 */
import { promisify } from 'util';
import { toString } from 'lodash';
import { JobJson } from './job';
import { SandboxedJob } from '../interfaces/sandboxed-job';

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
    err = new Error(toString(err));
  }
  process.send({
    cmd: 'failed',
    value: err,
  });
  throw err;
});

/**
 * Enhance the given job argument with some functions
 * that can be called from the sandboxed job processor.
 *
 * Note, the `job` argument is a JSON deserialized message
 * from the main node process to this forked child process,
 * the functions on the original job object are not in tact.
 * The wrapped job adds back some of those original functions.
 */
function wrapJob(job: JobJson): SandboxedJob {
  let progressValue = job.progress;

  return {
    ...job,
    data: JSON.parse(job.data || '{}'),
    opts: JSON.parse(job.opts || '{}'),
    returnValue: JSON.parse(job.returnvalue || '{}'),
    /*
     * Emulate the real job `progress` function.
     * If no argument is given, it behaves as a sync getter.
     * If an argument is given, it behaves as an async setter.
     */
    progress: (progress?: any) => {
      if (progress) {
        // Locally store reference to new progress value
        // so that we can return it from this process synchronously.
        progressValue = progress;
        // Send message to update job progress.
        process.send({
          cmd: 'progress',
          value: progress,
        });
        return Promise.resolve();
      } else {
        // Return the last known progress value.
        return progressValue;
      }
    },
    /*
     * Emulate the real job `log` function.
     */
    log: (row: any) => {
      process.send({
        cmd: 'log',
        value: row,
      });
    },
  };
}
