import { JobsOptions } from './jobs-options';
import { QueueOptions } from './queue-options';

export interface FlowJob {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: Omit<JobsOptions, 'parent'>;
  children?: FlowJob[];
}

export type FlowQueuesOpts = Record<
  string,
  Omit<QueueOptions, 'connection' | 'prefix'>
>;

export interface FlowOpts {
  queuesOptions: FlowQueuesOpts;
}
