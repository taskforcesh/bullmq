import { JobsOptions } from '../types';

/**
 * Describes the parent for a Job.
 */
export interface Parent<T> {
  name: string;
  prefix?: string;
  queue?: string;
  data?: T;
  opts?: JobsOptions;
}

export interface ParentKeys {
  id?: string;
  queueKey: string;
  fpof?: boolean;
  rdof?: boolean;
  idof?: boolean;
  cpof?: boolean;
}

export type ParentKeyOpts = {
  waitChildrenKey?: string;
  parentDependenciesKey?: string;
  parentKey?: string;
};
