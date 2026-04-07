import { JobJsonSandbox, JobProgress, JobsOptions } from '../types';
import { MoveToWaitingChildrenOpts } from './minimal-job';

/**
 * @see {@link https://docs.bullmq.io/guide/workers/sandboxed-processors}
 */
export interface SandboxedJob<T = any, R = any> extends Omit<
  JobJsonSandbox,
  'data' | 'opts' | 'returnValue'
> {
  data: T;
  opts: JobsOptions;
  queueQualifiedName: string;
  returnValue: R;
  getChildrenValues: <CT = any>() => Promise<{ [jobKey: string]: CT }>;
  getDependenciesCount: (opts?: {
    failed?: boolean;
    ignored?: boolean;
    processed?: boolean;
    unprocessed?: boolean;
  }) => Promise<{
    failed?: number;
    ignored?: number;
    processed?: number;
    unprocessed?: number;
  }>;
  getIgnoredChildrenFailures: () => Promise<{ [jobKey: string]: string }>;
  log: (row: any) => void;
  moveToDelayed: (timestamp: number, token?: string) => Promise<void>;
  moveToWait: (token?: string) => Promise<void>;
  moveToWaitingChildren: (
    token?: string,
    opts?: MoveToWaitingChildrenOpts,
  ) => Promise<boolean>;
  updateData: (data: any) => Promise<void>;
  updateProgress: (value: JobProgress) => Promise<void>;
}
