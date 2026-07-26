import { JobsOptions } from '../types';
import { QueueOptions } from './queue-options';

type FlowParentJobOpts = Omit<JobsOptions, 'deduplication' | 'repeat'>;

type FlowNestedLeafJobOpts = Omit<JobsOptions, 'parent' | 'repeat'>;

type FlowRootLeafJobOpts = Omit<JobsOptions, 'repeat'>;

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
