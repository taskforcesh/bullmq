import { JobsOptions } from '../types';
import { QueueOptions } from './queue-options';

export interface FlowJobBase<T> {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: Omit<T, 'debounce' | 'deduplication' | 'repeat'>;
  children?: FlowChildJob[];
}

export type FlowChildJob = FlowJobBase<
  Omit<JobsOptions, 'debounce' | 'deduplication' | 'parent' | 'repeat'>
>;

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
