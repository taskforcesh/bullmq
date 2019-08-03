import childProcess, { ChildProcess } from 'child_process';
import path from 'path';
import _ from 'lodash';
import getPort from 'get-port';

const fork = childProcess.fork;

const convertExecArgv = (execArgv: any): Promise<string[]> => {
  const standard: string[] = [];
  const promises: Promise<any>[] = [];

  _.forEach(execArgv, arg => {
    if (arg.indexOf('--inspect') === -1) {
      standard.push(arg);
    } else {
      const argName = arg.split('=')[0];
      promises.push(
        getPort().then((port: any) => {
          return `${argName}=${port}`;
        }),
      );
    }
  });

  return Promise.all(promises).then(convertedArgs => {
    return standard.concat(convertedArgs);
  });
};

const initChild = function(child: any, processFile: any) {
  return new Promise(resolve => {
    child.send({ cmd: 'init', value: processFile }, resolve);
  });
};

export class ChildPool {
  retained: any = {};
  free: any = {};

  constructor() {
    // todo for what this check is needed? to implement singleton?
    if (!(this instanceof ChildPool)) {
      return new ChildPool();
    }
  }

  retain(processFile: any): Promise<ChildProcess & { processFile?: string }> {
    const _this = this;
    let child = _this.getFree(processFile).pop();

    if (child) {
      _this.retained[child.pid] = child;
      return Promise.resolve(child);
    }

    return convertExecArgv(process.execArgv).then(execArgv => {
      child = fork(path.join(__dirname, './master.js'), execArgv);
      child.processFile = processFile;

      _this.retained[child.pid] = child;

      child.on('exit', _this.remove.bind(_this, child));

      return initChild(child, child.processFile).then(() => {
        return child;
      });
    });
  }

  release(child: any) {
    delete this.retained[child.pid];
    this.getFree(child.processFile).push(child);
  }

  remove(child: any) {
    delete this.retained[child.pid];

    const free = this.getFree(child.processFile);

    const childIndex = free.indexOf(child);
    if (childIndex > -1) {
      free.splice(childIndex, 1);
    }
  }

  kill(child: ChildProcess, signal?: string) {
    child.kill(signal || 'SIGKILL');
    this.remove(child);
  }

  clean() {
    const children = _.values(this.retained).concat(this.getAllFree());

    children.forEach(child => {
      // TODO: We may want to use SIGKILL if the process does not die after some time.
      this.kill(child, 'SIGTERM');
    });

    this.retained = {};
    this.free = {};
  }

  getFree(id: any) {
    return (this.free[id] = this.free[id] || []);
  }

  getAllFree() {
    return _.flatten(_.values(this.free));
  }
}

export const pool = new ChildPool();
