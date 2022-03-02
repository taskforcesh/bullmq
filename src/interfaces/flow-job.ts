import { JobsOptions } from './jobs-options';
import { QueueOptions } from './queue-options';

export interface FlowJob {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: Omit<JobsOptions, 'parent' | 'repeat'>;
  children?: FlowJob[];
}

export type FlowQueuesOpts = Record<
  string,
  Omit<QueueOptions, 'connection' | 'prefix'>
>;

export interface FlowOpts {
  /**
   * Map of options for Queue classes.
   */
  queuesOptions: FlowQueuesOpts;
}
