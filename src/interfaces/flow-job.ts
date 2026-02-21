import { DeduplicationOptions, JobsOptions } from '../types';
import { QueueOptions } from './queue-options';

export interface FlowJobBase<T> {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: Omit<T, 'repeat'>;
  children?: FlowChildJob[];
}

export type FlowChildJob = FlowJobBase<
  Omit<JobsOptions, 'debounce' | 'deduplication' | 'parent'>
>;

export type FlowJob = FlowJobBase<
  Omit<JobsOptions, 'debounce' | 'deduplication'> & {
    debounce?: Omit<DeduplicationOptions, 'replace'>;
    deduplication?: Omit<DeduplicationOptions, 'replace'>;
  }
>;

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
