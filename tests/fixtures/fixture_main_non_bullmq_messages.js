/**
 * Custom main file that sends non-BullMQ messages during initialization
 * to test that the child process properly ignores them.
 */
'use strict';

const { ChildProcessor } = require('../../dist/cjs/classes/child-processor');
const { ParentCommand, ChildCommand } = require('../../dist/cjs/enums');
const { errorToJSON, toString } = require('../../dist/cjs/utils');

const send = async msg => {
  if (process.send) {
    return new Promise((resolve, reject) => {
      process.send(msg, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
};

const childProcessor = new ChildProcessor(send, process);

process.on('message', async msg => {
  try {
    switch (msg.cmd) {
      case ChildCommand.Init:
        // Send non-BullMQ messages before initialization
        await send({ type: 'debug', message: 'Starting initialization' });
        await send({ randomKey: 'randomValue' });
        await send({ cmd: 'INVALID_COMMAND' });
        await send({ cmd: 999 });

        // Now do the actual initialization
        await childProcessor.init(msg.value);
        break;
      case ChildCommand.Start:
        await childProcessor.start(msg.job, msg?.token);
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

process.on('uncaughtException', async err => {
  if (typeof err !== 'object') {
    err = new Error(toString(err));
  }

  await send({
    cmd: ParentCommand.Failed,
    value: errorToJSON(err),
  });

  process.exit();
});
