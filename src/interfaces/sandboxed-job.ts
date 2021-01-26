import { JobJson } from '../classes/job';
import { JobsOptions } from './jobs-options';

/**
 * @see {@link https://docs.bullmq.io/guide/workers/sandboxed-processors}
 */
export interface SandboxedJob<T = any, R = any>
  extends Omit<JobJson, 'data' | 'opts' | 'progress' | 'log' | 'returnValue'> {
  data: T;
  opts: JobsOptions;
  progress:
    | (() => object | number)
    | ((value: object | number) => Promise<void>);
  log: (row: any) => void;
  returnValue: R;
}
