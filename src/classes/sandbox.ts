import { ChildCommand, ChildMessage, ParentCommand } from '../interfaces';
import { ChildPool } from './child-pool';
import { Job } from './job';

const sandbox = <T, R, N extends string>(
  processFile: any,
  childPool: ChildPool,
) => {
  return async function process(job: Job<T, R, N>): Promise<R> {
    const child = await childPool.retain(processFile);
    let msgHandler: any;
    let exitHandler: any;

    await child.send({
      cmd: ChildCommand.Start,
      job: job.asJSONSandbox(),
    });

    const done: Promise<R> = new Promise((resolve, reject) => {
      msgHandler = async (msg: ChildMessage) => {
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
          case ParentCommand.Update:
            await job.update(msg.value);
            break;
        }
      };

      exitHandler = (exitCode: any, signal: any) => {
        reject(
          new Error('Unexpected exit code: ' + exitCode + ' signal: ' + signal),
        );
      };

      child.on('message', msgHandler);
      child.on('exit', exitHandler);
    });

    try {
      await done;
      return done;
    } finally {
      child.off('message', msgHandler);
      child.off('exit', exitHandler);

      if (child.exitCode !== null || /SIG.*/.test(`${child.signalCode}`)) {
        childPool.remove(child);
      } else {
        childPool.release(child);
      }
    }
  };
};

export default sandbox;
