import { ParentCommand } from '../enums';
import {
  MoveToWaitingChildrenOpts,
  Receiver,
  SandboxedJob,
} from '../interfaces';
import { JobJsonSandbox, JobProgress } from '../types';
import { errorToJSON } from '../utils';

enum ChildStatus {
  Idle,
  Started,
  Terminating,
  Errored,
}

const RESPONSE_TIMEOUT = process.env.NODE_ENV === 'test' ? 500 : 5_000;

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

  constructor(
    private send: (msg: any) => Promise<void>,
    private receiver: Receiver,
  ) {}

  public async init(processorFile: string): Promise<void> {
    let processor;
    try {
      const { default: processorFn } = await import(processorFile);

      if (processorFn instanceof Promise) {
        processor = await processorFn;
      } else {
        processor = processorFn;
      }

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
      queueQualifiedName: job.queueQualifiedName,
      data: JSON.parse(job.data || '{}'),
      opts: job.opts,
      returnValue: JSON.parse(job.returnvalue || '{}'),
      /*
       * Proxy `updateProgress` function, should works as `progress` function.
       */
      async updateProgress(progress: JobProgress) {
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
       * Proxy job `log` function.
       */
      log: async (row: any) => {
        await send({
          cmd: ParentCommand.Log,
          value: row,
        });
      },
      /*
       * Proxy `moveToDelayed` function.
       */
      moveToDelayed: async (timestamp: number, token?: string) => {
        await send({
          cmd: ParentCommand.MoveToDelayed,
          value: { timestamp, token },
        });
      },
      /*
       * Proxy `moveToWait` function.
       */
      moveToWait: async (token?: string) => {
        await send({
          cmd: ParentCommand.MoveToWait,
          value: { token },
        });
      },

      /*
       * Proxy `moveToWaitingChildren` function.
       */
      moveToWaitingChildren: async (
        token?: string,
        opts?: MoveToWaitingChildrenOpts,
      ): Promise<boolean> => {
        const requestId = Math.random().toString(36).substring(2, 15);
        await send({
          requestId,
          cmd: ParentCommand.MoveToWaitingChildren,
          value: { token, opts },
        });

        return waitResponse(
          requestId,
          this.receiver,
          RESPONSE_TIMEOUT,
          'moveToWaitingChildren',
        ) as Promise<boolean>;
      },

      /*
       * Proxy `updateData` function.
       */
      updateData: async (data: any) => {
        await send({
          cmd: ParentCommand.Update,
          value: data,
        });
        wrappedJob.data = data;
      },

      /**
       * Proxy `getChildrenValues` function.
       */
      getChildrenValues: async () => {
        const requestId = Math.random().toString(36).substring(2, 15);
        await send({
          requestId,
          cmd: ParentCommand.GetChildrenValues,
        });

        return waitResponse(
          requestId,
          this.receiver,
          RESPONSE_TIMEOUT,
          'getChildrenValues',
        );
      },

      /**
       * Proxy `getIgnoredChildrenFailures` function.
       *
       * This method sends a request to retrieve the failures of ignored children
       * and waits for a response from the parent process.
       *
       * @returns - A promise that resolves with the ignored children failures.
       * The exact structure of the returned data depends on the parent process implementation.
       */
      getIgnoredChildrenFailures: async () => {
        const requestId = Math.random().toString(36).substring(2, 15);
        await send({
          requestId,
          cmd: ParentCommand.GetIgnoredChildrenFailures,
        });

        return waitResponse(
          requestId,
          this.receiver,
          RESPONSE_TIMEOUT,
          'getIgnoredChildrenFailures',
        );
      },
    };

    return wrappedJob;
  }
}

const waitResponse = async (
  requestId: string,
  receiver: Receiver,
  timeout: number,
  cmd: string,
) => {
  return new Promise((resolve, reject) => {
    const listener = (msg: { requestId: string; value: any }) => {
      if (msg.requestId === requestId) {
        resolve(msg.value);
        receiver.off('message', listener);
      }
    };
    receiver.on('message', listener);

    setTimeout(() => {
      receiver.off('message', listener);

      reject(new Error(`TimeoutError: ${cmd} timed out in (${timeout}ms)`));
    }, timeout);
  });
};
