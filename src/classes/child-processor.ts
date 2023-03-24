import { promisify } from 'util';
import { JobJson, ParentCommand, SandboxedJob } from '../interfaces';
import { childSend, errorToJSON } from '../utils';

enum ChildStatus {
  Idle,
  Started,
  Terminating,
  Errored,
}

/**
 * ChildProcessor
 *
 * This class acts as the interface between a child process and it parent process
 * so that jobs can be processed in different processes than the parent.
 *
 */
export class ChildProcessor {
  public status?: ChildStatus;
  public processor: any;
  public currentJobPromise: Promise<unknown> | undefined;

  public async init(processorFile: string): Promise<void> {
    let processor;
    try {
      processor = require(processorFile);

      if (processor.default) {
        // support es2015 module.
        processor = processor.default;
      }

      if (typeof processor !== 'function') {
        throw new Error('No function is exported in processor file');
      }
    } catch (err) {
      this.status = ChildStatus.Errored;
      return childSend(process, {
        cmd: ParentCommand.InitFailed,
        err: errorToJSON(err),
      });
    }

    if (processor.length > 1) {
      processor = promisify(processor);
    } else {
      const origProcessor = processor;
      processor = function (...args: any[]) {
        try {
          return Promise.resolve(origProcessor(...args));
        } catch (err) {
          return Promise.reject(err);
        }
      };
    }
    this.processor = processor;
    this.status = ChildStatus.Idle;
    await childSend(process, {
      cmd: ParentCommand.InitCompleted,
    });
  }

  public async start(jobJson: JobJson): Promise<void> {
    if (this.status !== ChildStatus.Idle) {
      return childSend(process, {
        cmd: ParentCommand.Error,
        err: errorToJSON(new Error('cannot start a not idling child process')),
      });
    }
    this.status = ChildStatus.Started;
    this.currentJobPromise = (async () => {
      try {
        const job = wrapJob(jobJson);
        const result = (await this.processor(job)) || {};
        await childSend(process, {
          cmd: ParentCommand.Completed,
          value: result,
        });
      } catch (err) {
        await childSend(process, {
          cmd: ParentCommand.Failed,
          value: errorToJSON(!(<Error>err).message ? new Error(<any>err) : err),
        });
      } finally {
        this.status = ChildStatus.Idle;
        this.currentJobPromise = undefined;
      }
    })();
  }

  public async stop(): Promise<void> {}

  async waitForCurrentJobAndExit(): Promise<void> {
    this.status = ChildStatus.Terminating;
    try {
      await this.currentJobPromise;
    } finally {
      process.exit(process.exitCode || 0);
    }
  }
}

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

  const updateProgress = async (progress: number | object) => {
    // Locally store reference to new progress value
    // so that we can return it from this process synchronously.
    progressValue = progress;
    // Send message to update job progress.
    await childSend(process, {
      cmd: ParentCommand.Progress,
      value: progress,
    });
  };

  return {
    ...job,
    data: JSON.parse(job.data || '{}'),
    opts: job.opts,
    returnValue: JSON.parse(job.returnvalue || '{}'),
    /*
     * Emulate the real job `updateProgress` function, should works as `progress` function.
     */
    updateProgress,
    /*
     * Emulate the real job `log` function.
     */
    log: async (row: any) => {
      childSend(process, {
        cmd: ParentCommand.Log,
        value: row,
      });
    },
    /*
     * Emulate the real job `update` function.
     */
    update: async (data: any) => {
      childSend(process, {
        cmd: ParentCommand.Update,
        value: data,
      });
    },
  };
}
