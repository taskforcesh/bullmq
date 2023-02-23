import { JobsOptions } from '../types';
import { QueueOptions } from './queue-options';

interface FlowJobBase<T> {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: Omit<T, 'repeat'>;
  children?: FlowChildJob[];
}

export type FlowChildJob = FlowJobBase<Omit<JobsOptions, 'parent'>>;

export type FlowJob = FlowJobBase<JobsOptions>;

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
