import * as path from 'path';
import { Child } from './child';
import { SandboxedOptions } from '../interfaces';

const CHILD_KILL_TIMEOUT = 30_000;

interface ChildPoolOpts extends SandboxedOptions {
  mainFile?: string;
}

const supportCJS = () => {
  return (
    typeof require === 'function' &&
    typeof module === 'object' &&
    typeof module.exports === 'object'
  );
};

export class ChildPool {
  retained: { [key: number]: Child } = {};
  free: { [key: string]: Child[] } = {};
  private opts: ChildPoolOpts;

  constructor({
    mainFile = supportCJS()
      ? path.join(process.cwd(), 'dist/cjs/classes/main.js')
      : path.join(process.cwd(), 'dist/esm/classes/main.js'),
    useWorkerThreads,
    workerForkOptions,
    workerThreadsOptions,
  }: ChildPoolOpts) {
    this.opts = {
      mainFile,
      useWorkerThreads,
      workerForkOptions,
      workerThreadsOptions,
    };
  }

  async retain(processFile: string): Promise<Child> {
    let child = this.getFree(processFile).pop();

    if (child) {
      this.retained[child.pid] = child;
      return child;
    }

    child = new Child(this.opts.mainFile, processFile, {
      useWorkerThreads: this.opts.useWorkerThreads,
      workerForkOptions: this.opts.workerForkOptions,
      workerThreadsOptions: this.opts.workerThreadsOptions,
    });

    child.on('exit', this.remove.bind(this, child));

    try {
      await child.init();

      // Check status here as well, in case the child exited before we could
      // retain it.
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error('Child exited before it could be retained');
      }

      this.retained[child.pid] = child;

      return child;
    } catch (err) {
      console.error(err);
      // A child that failed to initialize (or exited during init) must never
      // be released back into the free pool, otherwise it becomes a "zombie"
      // that is reused for every subsequent job and fails them instantly.
      // Kill and remove it so a fresh child is forked on the next retain.
      // The child also exits itself after a failed init (see ChildProcessor),
      // so this is normally a no-op; log any kill failure instead of silently
      // swallowing it so a lingering child would not go unnoticed.
      this.kill(child, 'SIGKILL').catch(killErr => {
        console.error('Failed to kill child after init error:', killErr);
      });
      throw err;
    }
  }

  release(child: Child): void {
    delete this.retained[child.pid];
    this.getFree(child.processFile).push(child);
  }

  remove(child: Child): void {
    delete this.retained[child.pid];

    const free = this.getFree(child.processFile);

    const childIndex = free.indexOf(child);
    if (childIndex > -1) {
      free.splice(childIndex, 1);
    }
  }

  async kill(
    child: Child,
    signal: 'SIGTERM' | 'SIGKILL' = 'SIGKILL',
  ): Promise<void> {
    this.remove(child);
    return child.kill(signal, CHILD_KILL_TIMEOUT);
  }

  async clean(): Promise<void> {
    const children = Object.values(this.retained).concat(this.getAllFree());
    this.retained = {};
    this.free = {};

    await Promise.all(children.map(c => this.kill(c, 'SIGTERM')));
  }

  getFree(id: string): Child[] {
    return (this.free[id] = this.free[id] || []);
  }

  getAllFree(): Child[] {
    return Object.values(this.free).reduce(
      (first, second) => first.concat(second),
      [],
    );
  }
}
