import { ForkOptions } from 'child_process';
import { WorkerOptions as WorkerThreadsOptions } from 'worker_threads';

export interface SandboxedOptions {
  /**
   * Use Worker Threads instead of Child Processes.
   * Note: This option can only be used when specifying
   * a file for the processor argument.
   *
   * @defaultValue false
   */
  useWorkerThreads?: boolean;

  /**
   * Support passing Worker Fork Options.
   * Note: This option can only be used when specifying
   * a file for the processor argument and useWorkerThreads is passed as false (default value).
   * @see {@link https://nodejs.org/api/child_process.html#child_processforkmodulepath-args-options}
   */
  workerForkOptions?: ForkOptions;

  /**
   * Support passing Worker Threads Options.
   * Note: This option can only be used when specifying
   * a file for the processor argument and useWorkerThreads is passed as true.
   * @see {@link https://nodejs.org/api/worker_threads.html#new-workerfilename-options}
   */
  workerThreadsOptions?: WorkerThreadsOptions;
}
