import { ChildProcess, fork } from 'child_process';
import * as path from 'path';
import { forEach, values, flatten } from 'lodash';
import * as getPort from 'get-port';
import * as fs from 'fs';
import { promisify } from 'util';
import { killAsync } from './process-utils';

const stat = promisify(fs.stat);

const CHILD_KILL_TIMEOUT = 30_000;

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

async function initChild(child: ChildProcess, processFile: string) {
  const onComplete = new Promise(resolve => {
    const onMessageHandler = (msg: any) => {
      if (msg.cmd === 'init-complete') {
        resolve();
        child.off('message', onMessageHandler);
      }
    };
    child.on('message', onMessageHandler);
  });
  await new Promise(resolve =>
    child.send({ cmd: 'init', value: processFile }, resolve),
  );
  await onComplete;
}

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

  async kill(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL' = 'SIGKILL') {
    this.remove(child);
    await killAsync(child, signal, CHILD_KILL_TIMEOUT);
  }

  async clean() {
    const children = values(this.retained).concat(this.getAllFree());
    this.retained = {};
    this.free = {};

    await Promise.all(children.map(c => this.kill(c, 'SIGTERM')));
  }

  getFree(id: string): ChildProcessExt[] {
    return (this.free[id] = this.free[id] || []);
  }

  getAllFree() {
    return flatten(values(this.free));
  }
}
