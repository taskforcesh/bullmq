import { JobsOptions } from './jobs-options';

export interface FlowChildJob extends FlowJob {
  opts?: Omit<JobsOptions, 'parent'>;
}

export interface FlowJob {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: JobsOptions;
  children?: FlowChildJob[];
}
