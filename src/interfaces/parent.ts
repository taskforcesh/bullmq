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
  id: string;
  queueKey: string;
}
