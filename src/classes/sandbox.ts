import { ChildCommand, ParentCommand } from '../enums';
import { ChildMessage } from '../interfaces';
import { Child } from './child';
import { ChildPool } from './child-pool';
import { Job } from './job';

const sandbox = <T, R, N extends string>(
  processFile: any,
  childPool: ChildPool,
) => {
  return async function process(job: Job<T, R, N>, token?: string): Promise<R> {
    let child: Child;
    let msgHandler: any;
    try {
      const done: Promise<R> = new Promise((resolve, reject) => {
        const initChild = async () => {
          try {
            child = await childPool.retain(processFile, reject);

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
                  await job.moveToDelayed(
                    msg.value?.timestamp,
                    msg.value?.token,
                  );
                  break;
                case ParentCommand.Update:
                  await job.updateData(msg.value);
                  break;
              }
            };

            child.on('message', msgHandler);

            child.send({
              cmd: ChildCommand.Start,
              job: job.asJSONSandbox(),
              token,
            });
          } catch (error) {
            reject(error);
          }
        };
        initChild();
      });

      await done;
      return done;
    } finally {
      if (child) {
        child.off('message', msgHandler);

        if (child.exitCode !== null || /SIG.*/.test(`${child.signalCode}`)) {
          childPool.remove(child);
        } else {
          childPool.release(child);
        }
      }
    }
  };
};

export default sandbox;
