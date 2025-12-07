import { JobsOptions } from '../types/job-options';

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
  addToWaitingChildren?: boolean;
  parentDependenciesKey?: string;
  parentKey?: string;
};
