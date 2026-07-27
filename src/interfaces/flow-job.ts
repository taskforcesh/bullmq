import { DeduplicationOptions, JobsOptions } from '../types';
import { QueueOptions } from './queue-options';

type FlowDeduplicationOptions = Omit<DeduplicationOptions, 'replace'>;

type FlowJobOpts = Omit<JobsOptions, 'deduplication'> & {
  deduplication?: FlowDeduplicationOptions;
};

type FlowParentJobOpts = Omit<
  FlowJobOpts,
  'deduplication' | 'parent' | 'repeat'
>;

type FlowNestedLeafJobOpts = Omit<FlowJobOpts, 'parent' | 'repeat'>;

type FlowRootLeafJobOpts = Omit<FlowJobOpts, 'repeat'>;

export interface FlowJobBase<T> {
  name: string;
  queueName: string;
  data?: any;
  prefix?: string;
  opts?: T;
}

export type FlowNestedLeafJob = FlowJobBase<FlowNestedLeafJobOpts> & {
  children?: never;
};

export type FlowParentJob = FlowJobBase<FlowParentJobOpts> & {
  children: FlowJobNode[];
};

export type FlowJobNode = FlowParentJob | FlowNestedLeafJob;

export type FlowRootLeafJob = FlowJobBase<FlowRootLeafJobOpts> & {
  children?: never;
};

export type FlowJob = FlowRootLeafJob | FlowJobNode;

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
