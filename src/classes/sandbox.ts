import { Job } from './job';
import { ChildCommand, ChildMessage, ParentCommand } from '../interfaces';
import { ChildPool } from '../classes';

const sandbox = <T, R, N extends string>(
  processFile: any,
  childPool: ChildPool,
) => {
  return async function process(job: Job<T, R, N>): Promise<R> {
    const child = await childPool.retain(processFile);
    let msgHandler: any;
    let exitHandler: any;

    child.send({
      cmd: ChildCommand.Start,
      job: job.asJSON(),
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
      child.removeListener('message', msgHandler);
      child.removeListener('exit', exitHandler);

      if (child.exitCode !== null || /SIG.*/.test(`${child.signalCode}`)) {
        childPool.remove(child);
      } else {
        childPool.release(child);
      }
    }
  };
};

export default sandbox;
