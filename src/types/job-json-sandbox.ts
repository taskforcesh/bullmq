import { JobJson } from '../interfaces';

export type JobJsonSandbox = JobJson & {
  queueName: string;
  queueQualifiedName: string;
  prefix: string;
};
