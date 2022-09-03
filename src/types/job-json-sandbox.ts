import { JobJson, ParentKeys } from '../interfaces';

export type JobJsonSandbox = JobJson & {
  queueName: string;
  prefix: string;
};
