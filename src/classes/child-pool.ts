import { ChildProcess, fork } from 'child_process';
import * as path from 'path';
import { forEach, values, flatten } from 'lodash';
import * as getPort from 'get-port';
import * as fs from 'fs';
import { promisify } from 'util';

const stat = promisify(fs.stat);

export interface ChildProcessExt extends ChildProcess {
  processFile?: string;
}

const convertExecArgv = async (execArgv: string[]): Promise<string[]> => {
  const standard: string[] = [];
  const convertedArgs: string[] = [];

  forEach(execArgv, async arg => {
    if (arg.indexOf('--inspect') === -1) {
      standard.push(arg);
    } else {
      const argName = arg.split('=')[0];
      const port = await getPort();
      convertedArgs.push(`${argName}=${port}`);
    }
  });

  return standard.concat(convertedArgs);
};

const initChild = function(child: ChildProcess, processFile: string) {
  return new Promise(resolve => {
    child.send({ cmd: 'init', value: processFile }, resolve);
  });
};

export class ChildPool {
  retained: { [key: number]: ChildProcessExt } = {};
  free: { [key: string]: ChildProcessExt[] } = {};

  constructor() {}

  async retain(processFile: string): Promise<ChildProcessExt> {
    const _this = this;
    let child = _this.getFree(processFile).pop();

    if (child) {
      _this.retained[child.pid] = child;
      return child;
    }

    const execArgv = await convertExecArgv(process.execArgv);

    let masterFile = path.join(__dirname, './master.js');
    try {
      await stat(masterFile); // would throw if file not exists
    } catch (_) {
      try {
        masterFile = path.join(process.cwd(), 'dist/classes/master.js');
        await stat(masterFile);
      } finally {
      }
    }

    child = fork(masterFile, [], { execArgv });
    child.processFile = processFile;

    _this.retained[child.pid] = child;

    child.on('exit', _this.remove.bind(_this, child));

    await initChild(child, child.processFile);
    return child;
  }

  release(child: ChildProcessExt) {
    delete this.retained[child.pid];
    this.getFree(child.processFile).push(child);
  }

  remove(child: ChildProcessExt) {
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
    const children = values(this.retained).concat(this.getAllFree());

    children.forEach(child => {
      // TODO: We may want to use SIGKILL if the process does not die after some time.
      this.kill(child, 'SIGTERM');
    });

    this.retained = {};
    this.free = {};
  }

  getFree(id: string): ChildProcessExt[] {
    return (this.free[id] = this.free[id] || []);
  }

  getAllFree() {
    return flatten(values(this.free));
  }
}
