const sandbox = (processFile: any, childPool: any) => {
  return async function process(job: any) {
    const child = await childPool.retain(processFile);
    let msgHandler: any;
    let exitHandler: any;

    child.send({
      cmd: 'start',
      job: job.asJSON(),
    });

    const done = new Promise((resolve, reject) => {
      msgHandler = (msg: any) => {
        switch (msg.cmd) {
          case 'completed':
            resolve(msg.value);
            break;
          case 'failed':
          case 'error': {
            const err = new Error();
            Object.assign(err, msg.value);
            reject(err);
            break;
          }
          case 'progress':
            job.updateProgress(msg.value);
            break;
          case 'log':
            job.log(msg.value);
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

      if (child.exitCode !== null || /SIG.*/.test(child.signalCode)) {
        childPool.remove(child);
      } else {
        childPool.release(child);
      }
    }
  };
};

export default sandbox;
