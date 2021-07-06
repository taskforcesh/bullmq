import { JobsOptions } from './jobs-options';

export interface FlowChildJob {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: Omit<JobsOptions, 'parent'>;
  children?: FlowChildJob[];
}

export interface FlowJob {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: JobsOptions;
  children?: FlowChildJob[];
}
