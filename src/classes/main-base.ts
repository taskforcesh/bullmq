/**
 * Wrapper for sandboxing.
 *
 */
import { ChildProcessor } from './child-processor';
import { ParentCommand, ChildCommand } from '../enums';
import { errorToJSON, toString } from '../utils';
import { Receiver } from '../interfaces';

export default (send: (msg: any) => Promise<void>, receiver: Receiver) => {
  const childProcessor = new ChildProcessor(send, receiver);

  receiver?.on('message', async msg => {
    try {
      switch (msg.cmd as ChildCommand) {
        case ChildCommand.Init:
          await childProcessor.init(msg.value);
          break;
        case ChildCommand.Start:
          await childProcessor.start(msg.job, msg?.token);
          break;
        case ChildCommand.Stop:
          break;
        case ChildCommand.Cancel:
          childProcessor.cancel(msg.value);
          break;
      }
    } catch (err) {
      console.error('Error handling child message');
    }
  });

  process.on('SIGTERM', () => childProcessor.waitForCurrentJobAndExit());
  process.on('SIGINT', () => childProcessor.waitForCurrentJobAndExit());

  process.on('uncaughtException', async (err: any) => {
    if (typeof err !== 'object') {
      err = new Error(toString(err));
    }

    await send({
      cmd: ParentCommand.Failed,
      value: errorToJSON(err),
    });

    // An uncaughException leaves this process in a potentially undetermined state so
    // we must exit
    process.exit();
  });
};
