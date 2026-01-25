import { ChildProcess, fork } from 'child_process';
import { AddressInfo, createServer } from 'net';
import { Worker } from 'worker_threads';
import { ChildCommand, ParentCommand } from '../enums';
import { SandboxedOptions } from '../interfaces';
import { EventEmitter } from 'events';

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

/**
 * Child class
 *
 * This class is used to create a child process or worker thread, and allows using
 * isolated processes or threads for processing jobs.
 *
 */
export class Child extends EventEmitter {
  childProcess: ChildProcess;
  worker: Worker;

  private _exitCode: number = null;
  private _signalCode: number = null;
  private _killed = false;

  constructor(
    private mainFile: string,
    public processFile: string,
    private opts: SandboxedOptions = {
      useWorkerThreads: false,
    },
  ) {
    super();
  }

  get pid() {
    if (this.childProcess) {
      return this.childProcess.pid;
    } else if (this.worker) {
      // Worker threads pids can become negative when they are terminated
      // so we need to use the absolute value to index the retained object
      return Math.abs(this.worker.threadId);
    } else {
      throw new Error('No child process or worker thread');
    }
  }

  get exitCode() {
    return this._exitCode;
  }

  get signalCode() {
    return this._signalCode;
  }

  get killed() {
    if (this.childProcess) {
      return this.childProcess.killed;
    }
    return this._killed;
  }

  async init(): Promise<void> {
    const execArgv = await convertExecArgv(process.execArgv);

    let parent: ChildProcess | Worker;

    if (this.opts.useWorkerThreads) {
      this.worker = parent = new Worker(this.mainFile, {
        execArgv,
        stdin: true,
        stdout: true,
        stderr: true,
        ...(this.opts.workerThreadsOptions
          ? this.opts.workerThreadsOptions
          : {}),
      });
    } else {
      this.childProcess = parent = fork(this.mainFile, [], {
        execArgv,
        stdio: 'pipe',
        ...(this.opts.workerForkOptions ? this.opts.workerForkOptions : {}),
      });
    }

    parent.on('exit', (exitCode: number, signalCode?: number) => {
      this._exitCode = exitCode;

      // Coerce to null if undefined for backwards compatibility
      signalCode = typeof signalCode === 'undefined' ? null : signalCode;
      this._signalCode = signalCode;

      this._killed = true;

      this.emit('exit', exitCode, signalCode);

      // Clean all listeners, we do not expect any more events after "exit"
      parent.removeAllListeners();
      this.removeAllListeners();
    });
    parent.on('error', (...args) => this.emit('error', ...args));
    parent.on('message', (...args) => this.emit('message', ...args));
    parent.on('close', (...args) => this.emit('close', ...args));

    parent.stdout.pipe(process.stdout);
    parent.stderr.pipe(process.stderr);

    await this.initChild();
  }

  async send(msg: any) {
    return new Promise<void>((resolve, reject) => {
      if (this.childProcess) {
        this.childProcess.send(msg, (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } else if (this.worker) {
        resolve(this.worker.postMessage(msg));
      } else {
        resolve();
      }
    });
  }

  private killProcess(signal: 'SIGTERM' | 'SIGKILL' = 'SIGKILL') {
    if (this.childProcess) {
      this.childProcess.kill(signal);
    } else if (this.worker) {
      this.worker.terminate();
    }
  }

  async kill(
    signal: 'SIGTERM' | 'SIGKILL' = 'SIGKILL',
    timeoutMs?: number,
  ): Promise<void> {
    if (this.hasProcessExited()) {
      return;
    }

    const onExit = onExitOnce(this.childProcess || this.worker);
    this.killProcess(signal);

    if (timeoutMs !== undefined && (timeoutMs === 0 || isFinite(timeoutMs))) {
      const timeoutHandle = setTimeout(() => {
        if (!this.hasProcessExited()) {
          this.killProcess('SIGKILL');
        }
      }, timeoutMs);
      await onExit;
      clearTimeout(timeoutHandle);
    }
    await onExit;
  }

  private async initChild() {
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
        this.off('message', onMessageHandler);
        this.off('close', onCloseHandler);
      };

      const onCloseHandler = (code: number, signal: number) => {
        if (code > 128) {
          code -= 128;
        }
        const msg = exitCodesErrors[code] || `Unknown exit code ${code}`;
        reject(
          new Error(`Error initializing child: ${msg} and signal ${signal}`),
        );
        this.off('message', onMessageHandler);
        this.off('close', onCloseHandler);
      };

      this.on('message', onMessageHandler);
      this.on('close', onCloseHandler);
    });

    await this.send({
      cmd: ChildCommand.Init,
      value: this.processFile,
    });
    await onComplete;
  }

  hasProcessExited(): boolean {
    return !!(this.exitCode !== null || this.signalCode);
  }
}

function onExitOnce(child: ChildProcess | Worker): Promise<void> {
  return new Promise(resolve => {
    child.once('exit', () => resolve());
  });
}

const getFreePort = async () => {
  return new Promise(resolve => {
    const server = createServer();
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
};

export const convertExecArgv = async (
  execArgv: string[],
): Promise<string[]> => {
  const resultArgs: string[] = [];

  for (const arg of execArgv) {
    const argName = arg.split('=')[0];

    if (argName === '--inspect' || argName === '--inspect-brk') {
      const port = await getFreePort();
      resultArgs.push(`${argName}=${port}`);
    }
  }

  return resultArgs;
};
