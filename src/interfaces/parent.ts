import { JobsOptions } from '../types/job-options';

/**
 * Describes the parent for a Job.
 */
export interface Parent<T> {
  /** Parent job name. */
  name: string;
  /** Prefix for the parent queue's keys. */
  prefix?: string;
  /** Name of the parent queue. */
  queue?: string;
  /** Parent job data. */
  data?: T;
  /** Job options for the parent. */
  opts?: JobsOptions;
}

/**
 * Redis-stored parent reference keys used internally by BullMQ.
 */
export interface ParentKeys {
  /** Parent job id. */
  id?: string;
  /** Fully-qualified Redis key for the parent queue. */
  queueKey: string;
  /** failParentOnFailure - if true, parent fails when child fails. */
  fpof?: boolean;
  /** removeDependencyOnFailure - if true, removes the child from parent's dependencies on failure. */
  rdof?: boolean;
  /** ignoreDependencyOnFailure - if true, moves child's id to failed dependencies on failure. */
  idof?: boolean;
  /** continueParentOnFailure - if true, parent starts processing when any child fails. */
  cpof?: boolean;
}

/**
 * Options passed when associating a child job with a parent during creation.
 */
export type ParentKeyOpts = {
  /** If true, adds the job to the parent's waiting-children set. */
  addToWaitingChildren?: boolean;
  /** Redis key holding the parent's dependencies set. */
  parentDependenciesKey?: string;
  /** Fully-qualified Redis key of the parent job. */
  parentKey?: string;
};
