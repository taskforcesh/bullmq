

//TODO remove for node >= 10
require('promise.prototype.finally').shim();

const sandbox = (processFile: any, childPool: any) => {
    return function process(job: any) {
        return childPool.retain(processFile).then((child: any) => {
            let msgHandler: any;
            let exitHandler: any;

            child.send({
                cmd: 'start',
                job: job.toJSON()
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
                        new Error(
                            'Unexpected exit code: ' + exitCode + ' signal: ' + signal
                        )
                    );
                };

                child.on('message', msgHandler);
                child.on('exit', exitHandler);
            });

            return done.finally(() => {
                child.removeListener('message', msgHandler);
                child.removeListener('exit', exitHandler);

                if (child.exitCode !== null) {
                    childPool.remove(child);
                } else {
                    childPool.release(child);
                }
            });
        });
    };
};

export default sandbox;
