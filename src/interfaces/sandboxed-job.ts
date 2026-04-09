import { JobJsonSandbox, JobProgress, JobsOptions } from '../types';
import { MoveToWaitingChildrenOpts } from './minimal-job';

/**
 * @see {@link https://docs.bullmq.io/guide/workers/sandboxed-processors}
 */
export interface SandboxedJob<T = any, R = any> extends Omit<
  JobJsonSandbox,
  'data' | 'opts' | 'returnvalue'
> {
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
  getChildrenValues: <CT = any>() => Promise<{ [jobKey: string]: CT }>;
  getIgnoredChildrenFailures: () => Promise<{ [jobKey: string]: string }>;
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
  returnValue: R;
}
