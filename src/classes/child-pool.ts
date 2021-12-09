import { ChildProcess, fork } from 'child_process';
import * as path from 'path';
import { flatten } from 'lodash';
import * as getPort from 'get-port';
import { killAsync } from './process-utils';
import { ParentCommand, ChildCommand } from '../interfaces';
import { parentSend } from '../utils';

const CHILD_KILL_TIMEOUT = 30_000;

export interface ChildProcessExt extends ChildProcess {
  processFile?: string;
}

const convertExecArgv = async (execArgv: string[]): Promise<string[]> => {
  const standard: string[] = [];
  const convertedArgs: string[] = [];

  for (let i = 0; i < execArgv.length; i++) {
    const arg = execArgv[i];
    if (arg.indexOf('--inspect') === -1) {
      standard.push(arg);
    } else {
      const argName = arg.split('=')[0];
      const port = await getPort();
      convertedArgs.push(`${argName}=${port}`);
    }
  }

  return standard.concat(convertedArgs);
};

/**
 * @see https://nodejs.org/api/process.html#process_exit_codes
 */
const exitCodesErrors: { [index: number]: string } = {
  1: 'Uncaught Fatal Exception',
  2: 'Unused',
  3: 'Internal JavaScript Parse Error',
  4: 'Internal JavaScript Evaluation Failure',
  5: 'Fatal Error',
  6: 'Non-function Internal Exception Handler',
  7: 'Internal Exception Handler Run-Time Failure',
  8: 'Unused',
  9: 'Invalid Argument',
  10: 'Internal JavaScript Run-Time Failure',
  12: 'Invalid Debug Argument',
  13: 'Unfinished Top-Level Await',
};

async function initChild(child: ChildProcess, processFile: string) {
  const onComplete = new Promise<void>((resolve, reject) => {
    const onMessageHandler = (msg: any) => {
      if (msg.cmd === ParentCommand.InitCompleted) {
        resolve();
      } else if (msg.cmd === ParentCommand.InitFailed) {
        const err = new Error();
        err.stack = msg.err.stack;
        err.message = msg.err.message;
        reject(err);
      }
      child.off('message', onMessageHandler);
      child.off('close', onCloseHandler);
    };

    const onCloseHandler = (code: number, signal: number) => {
      if (code > 128) {
        code -= 128;
      }
      const msg = exitCodesErrors[code] || `Unknown exit code ${code}`;
      reject(
        new Error(`Error initializing child: ${msg} and signal ${signal}`),
      );
      child.off('message', onMessageHandler);
      child.off('close', onCloseHandler);
    };

    child.on('message', onMessageHandler);

    // TODO: we need to clean this listener too.
    child.on('close', onCloseHandler);
  });

  await parentSend(child, { cmd: ChildCommand.Init, value: processFile });
  await onComplete;
}

export class ChildPool {
  retained: { [key: number]: ChildProcessExt } = {};
  free: { [key: string]: ChildProcessExt[] } = {};

  constructor(
    private masterFile = path.join(process.cwd(), 'dist/classes/master.js'),
  ) {}

  async retain(processFile: string): Promise<ChildProcessExt> {
    const _this = this;
    let child = _this.getFree(processFile).pop();

    if (child) {
      _this.retained[child.pid] = child;
      return child;
    }

    const execArgv = await convertExecArgv(process.execArgv);

    child = fork(this.masterFile, [], { execArgv, stdio: 'pipe' });
    child.processFile = processFile;

    _this.retained[child.pid] = child;

    child.on('exit', _this.remove.bind(_this, child));

    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);

    await initChild(child, child.processFile);
    return child;
  }

  release(child: ChildProcessExt): void {
    delete this.retained[child.pid];
    this.getFree(child.processFile).push(child);
  }

  remove(child: ChildProcessExt): void {
    delete this.retained[child.pid];

    const free = this.getFree(child.processFile);

    const childIndex = free.indexOf(child);
    if (childIndex > -1) {
      free.splice(childIndex, 1);
    }
  }

  async kill(
    child: ChildProcess,
    signal: 'SIGTERM' | 'SIGKILL' = 'SIGKILL',
  ): Promise<void> {
    this.remove(child);
    await killAsync(child, signal, CHILD_KILL_TIMEOUT);
  }

  async clean(): Promise<void> {
    const children = Object.values(this.retained).concat(this.getAllFree());
    this.retained = {};
    this.free = {};

    await Promise.all(children.map(c => this.kill(c, 'SIGTERM')));
  }

  getFree(id: string): ChildProcessExt[] {
    return (this.free[id] = this.free[id] || []);
  }

  getAllFree(): ChildProcessExt[] {
    return flatten(Object.values(this.free));
  }
}
