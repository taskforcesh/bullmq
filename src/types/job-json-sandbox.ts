import { JobJson } from '../interfaces/job-json';

export type JobJsonSandbox = JobJson & {
  queueName: string;
  queueQualifiedName: string;
  prefix: string;
};
