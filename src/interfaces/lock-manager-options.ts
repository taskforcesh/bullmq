import { WorkerOptions } from './worker-options';

export interface LockManagerOptions extends WorkerOptions {
  workerId: string;
  workerName: string;
}
