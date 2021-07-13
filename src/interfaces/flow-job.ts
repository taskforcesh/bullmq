import { JobsOptions } from './jobs-options';

interface FlowJobBase<T> {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: T;
  children?: FlowChildJob[];
}

export type FlowChildJob = FlowJobBase<Omit<JobsOptions, 'parent'>>;
export type FlowJob = FlowJobBase<JobsOptions>;
