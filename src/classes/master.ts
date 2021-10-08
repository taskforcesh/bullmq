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
let currentJobPromise: Promise<unknown> | undefined;

// same as process.send but waits until the send is complete
// the async version is used below because otherwise
// the termination handler may exit before the parent
// process has received the messages it requires
const processSendAsync = promisify(process.send.bind(process)) as (
  msg: any,
) => Promise<void>;

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

async function waitForCurrentJobAndExit() {
  status = 'TERMINATING';
  try {
    await currentJobPromise;
  } finally {
    process.exit(process.exitCode || 0);
  }
}

process.on('SIGTERM', waitForCurrentJobAndExit);
process.on('SIGINT', waitForCurrentJobAndExit);

process.on('message', msg => {
  switch (msg.cmd) {
    case 'init':
      try {
        processor = require(msg.value);
      } catch (err) {
        status = 'ERRORED';
        return process.send({
          cmd: 'init-failed',
          err: err.message,
        });
      }

      if (processor.default) {
        // support es2015 module.
        processor = processor.default;
      }
      if (processor.length > 1) {
        processor = promisify(processor);
      } else {
        const origProcessor = processor;
        processor = function(...args: any[]) {
          try {
            return Promise.resolve(origProcessor(...args));
          } catch (err) {
            return Promise.reject(err);
          }
        };
      }
      status = 'IDLE';
      process.send({
        cmd: 'init-complete',
      });
      break;

    case 'start':
      if (status !== 'IDLE') {
        return process.send({
          cmd: 'error',
          err: new Error('cannot start a not idling child process'),
        });
      }
      status = 'STARTED';
      currentJobPromise = (async () => {
        try {
          const result = (await processor(wrapJob(msg.job))) || {};
          await processSendAsync({
            cmd: 'completed',
            value: result,
          });
        } catch (err) {
          await processSendAsync({
            cmd: 'failed',
            value: !err.message ? new Error(err) : err,
          });
        } finally {
          status = 'IDLE';
          currentJobPromise = undefined;
        }
      })();
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

  const updateProgress = (progress: number | object) => {
    // Locally store reference to new progress value
    // so that we can return it from this process synchronously.
    progressValue = progress;
    // Send message to update job progress.
    process.send({
      cmd: 'progress',
      value: progress,
    });
    return Promise.resolve();
  };

  const progress = (progress?: number | object) => {
    if (progress) {
      return updateProgress(progress);
    } else {
      // Return the last known progress value.
      return progressValue;
    }
  };

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
    progress,
    /*
     * Emulate the real job `updateProgress` function, should works as `progress` function.
     */
    updateProgress,
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
