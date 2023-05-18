/**
 * Wrapper for sandboxing.
 *
 */
import { toString } from 'lodash';
import { ChildProcessor } from './child-processor';
import { ParentCommand, ChildCommand } from '../interfaces';
import { errorToJSON } from '../utils';

export default (
  send: (msg: any) => Promise<void>,
  receiver: { on: (evt: 'message', cb: (msg: any) => void) => void },
) => {
  const childProcessor = new ChildProcessor(send);

  receiver?.on('message', async msg => {
    try {
      switch (msg.cmd as ChildCommand) {
        case ChildCommand.Init:
          await childProcessor.init(msg.value);
          break;
        case ChildCommand.Start:
          await childProcessor.start(msg.job);
          break;
        case ChildCommand.Stop:
          break;
      }
    } catch (err) {
      console.error('Error handling child message');
    }
  });

  process.on('SIGTERM', () => childProcessor.waitForCurrentJobAndExit());
  process.on('SIGINT', () => childProcessor.waitForCurrentJobAndExit());

  process.on('uncaughtException', async (err: Error) => {
    if (!err.message) {
      err = new Error(toString(err));
    }
    await send({
      cmd: ParentCommand.Failed,
      value: errorToJSON(err),
    });

    // An uncaughException leaves this process in a potentially undetermined state so
    // we must exit
    process.exit(-1);
  });
};
