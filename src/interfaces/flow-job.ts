import { JobsOptions } from './jobs-options';

export interface FlowJob {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: Omit<JobsOptions, 'parent'>;
  children?: FlowJob[];
}
