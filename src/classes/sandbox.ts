import { ChildCommand, ChildMessage, ParentCommand } from '../interfaces';
import { ChildPool } from './child-pool';
import { Job } from './job';

const sandbox = <T, R, N extends string>(
  processFile: any,
  childPool: ChildPool,
) => {
  return async function process(job: Job<T, R, N>, token?: string): Promise<R> {
    const child = await childPool.retain(processFile);
    let msgHandler: any;
    let exitHandler: any;

    await child.send({
      cmd: ChildCommand.Start,
      job: job.asJSONSandbox(),
      token,
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
          case ParentCommand.MoveToDelayed:
            await job.moveToDelayed(msg.value?.timestamp, msg.value?.token);
            break;
          case ParentCommand.Update:
            await job.updateData(msg.value);
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
