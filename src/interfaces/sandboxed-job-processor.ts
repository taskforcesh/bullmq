import { SandboxedJob } from './sandboxed-job';

export type SandboxedJobProcessor<T = any, R = any> =
  | ((job: SandboxedJob<T, R>) => R | PromiseLike<R>)
  | ((
      job: SandboxedJob<T, R>,
      callback: (error: unknown, result: R) => void,
    ) => void);
