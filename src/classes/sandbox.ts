import { Job } from './job';
import { ChildCommand, ChildMessage, ParentCommand } from '../interfaces';
import { ChildPool } from '../classes';
import { parentSend } from '../utils';

export class Sandbox<T, R, N extends string> {
  constructor(
    private processFile: string,
    protected childPool = new ChildPool(),
  ) {}

  protected async commandsHandler(msg: ChildMessage, job: Job<T, R, N>) {
    {
      try {
        switch (msg.cmd) {
          case ParentCommand.Progress:
            await job.updateProgress(msg.value);
            break;
          case ParentCommand.Log:
            await job.log(msg.value);
            break;
        }
      } catch (err) {
        console.error('Error handling child message');
      }
    }
  }
  getProcessFn() {
    const processFn = async (job: Job<T, R, N>): Promise<R> => {
      const child = await this.childPool.retain(this.processFile);
      let msgHandler: any;
      let exitHandler: any;

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
            default:
              await this.commandsHandler(msg, job);
          }
        };

        exitHandler = (exitCode: any, signal: any) => {
          reject(
            new Error(
              'Unexpected exit code: ' + exitCode + ' signal: ' + signal,
            ),
          );
        };

        child.on('message', msgHandler);
        child.on('exit', exitHandler);
      });

      try {
        await parentSend(child, {
          cmd: ChildCommand.Start,
          job: job.asJSON(),
        });

        await done;
        return done;
      } finally {
        child.removeListener('message', msgHandler);
        child.removeListener('exit', exitHandler);

        if (child.exitCode !== null || /SIG.*/.test(`${child.signalCode}`)) {
          this.childPool.remove(child);
        } else {
          this.childPool.release(child);
        }
      }
    };
    return processFn;
  }

  clean() {
    return this.childPool.clean();
  }
}
