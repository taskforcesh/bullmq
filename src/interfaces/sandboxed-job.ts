import { JobsOptions } from '../types';
import { JobJson } from './job-json';

/**
 * @see {@link https://docs.bullmq.io/guide/workers/sandboxed-processors}
 */
export interface SandboxedJob<T = any, R = any>
  extends Omit<JobJson, 'data' | 'opts' | 'progress' | 'returnValue'> {
  data: T;
  opts: JobsOptions;
  updateProgress: (value: object | number) => Promise<void>;
  log: (row: any) => void;
  update: (data: any) => Promise<void>;
  getChildrenValues: <CT = any>() => Promise<{ [jobKey: string]: CT }>;
  returnValue: R;
}
