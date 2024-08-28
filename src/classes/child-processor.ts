import { ChildCommand, ParentCommand } from '../enums';
import { SandboxedJob, ParentMessage } from '../interfaces';
import { JobJsonSandbox } from '../types';
import { errorToJSON } from '../utils';

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
 * so that jobs can be processed in different processes.
 *
 */
export class ChildProcessor {
  public status?: ChildStatus;
  public processor: any;
  public currentJobPromise: Promise<unknown> | undefined;

  constructor(private send: (msg: any) => Promise<void>) {}

  public async init(processorFile: string): Promise<void> {
    let processor;
    try {
      const { default: processorFn } = await import(processorFile);
      processor = processorFn;

      if (processor.default) {
        // support es2015 module.
        processor = processor.default;
      }

      if (typeof processor !== 'function') {
        throw new Error('No function is exported in processor file');
      }
    } catch (err) {
      this.status = ChildStatus.Errored;
      return this.send({
        cmd: ParentCommand.InitFailed,
        err: errorToJSON(err),
      });
    }

    const origProcessor = processor;
    processor = function (job: SandboxedJob, token?: string) {
      try {
        return Promise.resolve(origProcessor(job, token));
      } catch (err) {
        return Promise.reject(err);
      }
    };

    this.processor = processor;
    this.status = ChildStatus.Idle;
    await this.send({
      cmd: ParentCommand.InitCompleted,
    });
  }

  public async start(jobJson: JobJsonSandbox, token?: string): Promise<void> {
    if (this.status !== ChildStatus.Idle) {
      return this.send({
        cmd: ParentCommand.Error,
        err: errorToJSON(new Error('cannot start a not idling child process')),
      });
    }
    this.status = ChildStatus.Started;
    this.currentJobPromise = (async () => {
      try {
        const job = this.wrapJob(jobJson, this.send);
        const result = await this.processor(job, token);
        await this.send({
          cmd: ParentCommand.Completed,
          value: typeof result === 'undefined' ? null : result,
        });
      } catch (err) {
        await this.send({
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

  /**
   * Enhance the given job argument with some functions
   * that can be called from the sandboxed job processor.
   *
   * Note, the `job` argument is a JSON deserialized message
   * from the main node process to this forked child process,
   * the functions on the original job object are not in tact.
   * The wrapped job adds back some of those original functions.
   */
  protected wrapJob(
    job: JobJsonSandbox,
    send: (msg: any) => Promise<void>,
  ): SandboxedJob {
    const wrappedJob = {
      ...job,
      data: JSON.parse(job.data || '{}'),
      opts: job.opts,
      returnValue: JSON.parse(job.returnvalue || '{}'),
      /*
       * Emulate the real job `updateProgress` function, should works as `progress` function.
       */
      async updateProgress(progress: number | object) {
        // Locally store reference to new progress value
        // so that we can return it from this process synchronously.
        this.progress = progress;
        // Send message to update job progress.
        await send({
          cmd: ParentCommand.Progress,
          value: progress,
        });
      },
      /*
       * Emulate the real job `log` function.
       */
      log: async (row: any) => {
        await send({
          cmd: ParentCommand.Log,
          value: row,
        });
      },
      /*
       * Emulate the real job `moveToDelayed` function.
       */
      moveToDelayed: async (timestamp: number, token?: string) => {
        await send({
          cmd: ParentCommand.MoveToDelayed,
          value: { timestamp, token },
        });
      },
      /*
       * Emulate the real job `updateData` function.
       */
      updateData: async (data: any) => {
        await send({
          cmd: ParentCommand.Update,
          value: data,
        });
        wrappedJob.data = data;
      },
      /*
       * Emulate the real job `getChildrenValues` function.
       */
      getChildrenValues: async <CT = any>(): Promise<{
        [jobKey: string]: CT;
      }> => {
        let msgHandler: any;

        console.log('hola');
        const done = new Promise<{
          [jobKey: string]: CT;
        }>((resolve, reject) => {
          msgHandler = async (msg: ParentMessage) => {
            switch (msg.cmd) {
              case ChildCommand.GetChildrenValues: {
                console.log('se llamo', msg.value);
                resolve(msg.value);
                break;
              }
              case ChildCommand.GetChildrenValuesError: {
                console.log('un error', msg.value);
                const err = new Error();
                Object.assign(err, msg.value);
                reject(err);
                break;
              }
            }
          };
        });

        process.on('message', msgHandler);
        send({
          cmd: ParentCommand.GetChildrenValues,
        });

        const childrenValues = await done;
        process.removeListener('message', msgHandler);

        return childrenValues;
      },
    };

    return wrappedJob;
  }
}
