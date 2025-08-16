import { JobJsonSandbox, JobProgress, JobsOptions } from '../types';
import { MoveToWaitingChildrenOpts } from './minimal-job';

/**
 * @see {@link https://docs.bullmq.io/guide/workers/sandboxed-processors}
 */
export interface SandboxedJob<T = any, R = any>
  extends Omit<JobJsonSandbox, 'data' | 'opts' | 'returnValue'> {
  data: T;
  opts: JobsOptions;
  queueQualifiedName: string;
  moveToDelayed: (timestamp: number, token?: string) => Promise<void>;
  moveToWait: (token?: string) => Promise<void>;
  moveToWaitingChildren: (
    token?: string,
    opts?: MoveToWaitingChildrenOpts,
  ) => Promise<boolean>;
  log: (row: any) => void;
  updateData: (data: any) => Promise<void>;
  updateProgress: (value: JobProgress) => Promise<void>;
  returnValue: R;
}
