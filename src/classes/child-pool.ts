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

  /**
   * Creates a new ChildPool that manages a set of sandboxed child processes
   * (or worker threads) used to run job processors.
   *
   * @param opts - Pool options.
   * @param opts.mainFile - Path to the main bootstrap file loaded inside each
   * child. Defaults to the bundled CJS or ESM `main.js` depending on the
   * runtime module system.
   * @param opts.useWorkerThreads - If true, spawn worker threads instead of
   * forked child processes.
   * @param opts.workerForkOptions - Options forwarded to `child_process.fork`
   * when not using worker threads.
   * @param opts.workerThreadsOptions - Options forwarded to the `Worker`
   * constructor when using worker threads.
   */
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

  /**
   * Retains a child for the given processor file. Reuses a free child when
   * one is available, otherwise spawns and initializes a new one.
   *
   * @param processFile - Absolute path to the processor file the child will
   * load and execute jobs from.
   * @returns A ready-to-use child instance bound to `processFile`.
   */
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
      this.release(child);
      throw err;
    }
  }

  /**
   * Releases a previously retained child back to the free pool so it can be
   * reused by a subsequent `retain` call.
   *
   * @param child - The child instance to release.
   */
  release(child: Child): void {
    delete this.retained[child.pid];
    this.getFree(child.processFile).push(child);
  }

  /**
   * Removes a child from both the retained map and the free pool. Typically
   * called when the underlying process or worker has exited.
   *
   * @param child - The child instance to remove from the pool.
   */
  remove(child: Child): void {
    delete this.retained[child.pid];

    const free = this.getFree(child.processFile);

    const childIndex = free.indexOf(child);
    if (childIndex > -1) {
      free.splice(childIndex, 1);
    }
  }

  /**
   * Removes a child from the pool and terminates it with the given signal.
   * If the child does not exit within the kill timeout it is force-killed.
   *
   * @param child - The child instance to terminate.
   * @param signal - Signal used to terminate the child. Defaults to `SIGKILL`.
   */
  async kill(
    child: Child,
    signal: 'SIGTERM' | 'SIGKILL' = 'SIGKILL',
  ): Promise<void> {
    this.remove(child);
    return child.kill(signal, CHILD_KILL_TIMEOUT);
  }

  /**
   * Terminates every child currently tracked by the pool (both retained and
   * free) and clears all internal references. Resolves once every child has
   * been killed.
   */
  async clean(): Promise<void> {
    const children = Object.values(this.retained).concat(this.getAllFree());
    this.retained = {};
    this.free = {};

    await Promise.all(children.map(c => this.kill(c, 'SIGTERM')));
  }

  /**
   * Returns the array of free children for a given processor file, creating
   * an empty entry on first access.
   *
   * @param id - Processor file path used as the pool key.
   * @returns The mutable array of free children for `id`.
   */
  getFree(id: string): Child[] {
    return (this.free[id] = this.free[id] || []);
  }

  /**
   * Returns every free child across all processor files in the pool.
   *
   * @returns A flat array containing every free child instance.
   */
  getAllFree(): Child[] {
    return Object.values(this.free).reduce(
      (first, second) => first.concat(second),
      [],
    );
  }
}
