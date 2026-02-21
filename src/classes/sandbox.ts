import { ChildCommand, ParentCommand } from '../enums';
import { ChildMessage } from '../interfaces';
import { Child } from './child';
import { ChildPool } from './child-pool';
import { Job } from './job';

const sandbox = <T, R, N extends string>(
  processFile: any,
  childPool: ChildPool,
) => {
  return async function process(
    job: Job<T, R, N>,
    token?: string,
    signal?: AbortSignal,
  ): Promise<R> {
    let child: Child;
    let msgHandler: any;
    let exitHandler: any;
    let abortHandler: (() => void) | undefined;
    try {
      const done: Promise<R> = new Promise((resolve, reject) => {
        const initChild = async () => {
          try {
            exitHandler = (exitCode: any, signal: any) => {
              reject(
                new Error(
                  'Unexpected exit code: ' + exitCode + ' signal: ' + signal,
                ),
              );
            };

            child = await childPool.retain(processFile);
            child.on('exit', exitHandler);

            msgHandler = async (msg: ChildMessage) => {
              try {
                switch (msg.cmd) {
                  case ParentCommand.Completed:
                    resolve(msg.value);
                    break;
                  case ParentCommand.Failed:
                  case ParentCommand.Error: {
                    const err = new Error();
                    Object.assign(err, msg.value);
                    reject(err);
                    break;
                  }
                  case ParentCommand.Progress:
                    await job.updateProgress(msg.value);
                    break;
                  case ParentCommand.Log:
                    await job.log(msg.value);
                    break;
                  case ParentCommand.MoveToDelayed:
                    await job.moveToDelayed(
                      msg.value?.timestamp,
                      msg.value?.token,
                    );
                    break;
                  case ParentCommand.MoveToWait:
                    await job.moveToWait(msg.value?.token);
                    break;
                  case ParentCommand.MoveToWaitingChildren:
                    {
                      const value = await job.moveToWaitingChildren(
                        msg.value?.token,
                        msg.value?.opts,
                      );
                      child.send({
                        requestId: msg.requestId,
                        cmd: ChildCommand.MoveToWaitingChildrenResponse,
                        value,
                      });
                    }
                    break;
                  case ParentCommand.Update:
                    await job.updateData(msg.value);
                    break;
                  case ParentCommand.GetChildrenValues:
                    {
                      const value = await job.getChildrenValues();
                      child.send({
                        requestId: msg.requestId,
                        cmd: ChildCommand.GetChildrenValuesResponse,
                        value,
                      });
                    }
                    break;
                  case ParentCommand.GetIgnoredChildrenFailures:
                    {
                      const value = await job.getIgnoredChildrenFailures();
                      child.send({
                        requestId: msg.requestId,
                        cmd: ChildCommand.GetIgnoredChildrenFailuresResponse,
                        value,
                      });
                    }
                    break;
                }
              } catch (err) {
                reject(err);
              }
            };

            child.on('message', msgHandler);

            child.send({
              cmd: ChildCommand.Start,
              job: job.asJSONSandbox(),
              token,
            });

            if (signal) {
              abortHandler = () => {
                try {
                  child.send({
                    cmd: ChildCommand.Cancel,
                    value: signal.reason,
                  });
                } catch {
                  // Child process may have already exited
                }
              };

              if (signal.aborted) {
                abortHandler();
              } else {
                signal.addEventListener('abort', abortHandler, { once: true });
              }
            }
          } catch (error) {
            reject(error);
          }
        };
        initChild();
      });

      await done;
      return done;
    } finally {
      // Note: There is a potential race where the signal is aborted between
      // `await done` and this cleanup. This is safe because:
      // 1. abortHandler has a try-catch for child process already exited
      // 2. The listener is added with `once: true`, so it fires at most once
      // 3. removeEventListener here is defensive cleanup only
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
      if (child) {
        child.off('message', msgHandler);
        child.off('exit', exitHandler);
        if (child.exitCode === null && child.signalCode === null) {
          childPool.release(child);
        }
      }
    }
  };
};

export default sandbox;
