import { JobJsonSandbox, JobProgress, JobsOptions } from '../types';

/**
 * @see {@link https://docs.bullmq.io/guide/workers/sandboxed-processors}
 */
export interface SandboxedJob<T = any, R = any>
  extends Omit<JobJsonSandbox, 'data' | 'opts' | 'returnValue'> {
  data: T;
  opts: JobsOptions;
  moveToDelayed: (timestamp: number, token?: string) => Promise<void>;
  moveToWait: (token?: string) => Promise<void>;
  log: (row: any) => void;
  updateData: (data: any) => Promise<void>;
  updateProgress: (value: JobProgress) => Promise<void>;
  returnValue: R;
}
