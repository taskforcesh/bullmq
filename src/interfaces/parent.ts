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
  /** Qualified parent queue key prefix/name (for example, `${prefix}:${queueName}`). */
  queueKey: string;
  /** failParentOnFailure - if true, parent fails when child fails. */
  fpof?: boolean;
  /** removeDependencyOnFailure - if true, removes the child from parent's dependencies on failure. */
  rdof?: boolean;
  /** ignoreDependencyOnFailure - if true, moves the child job key to failed dependencies on failure. */
  idof?: boolean;
  /** continueParentOnFailure - if true, parent starts processing when any child fails. */
  cpof?: boolean;
}

/**
 * Options used internally for parent/child relationship management when creating jobs
 * (including associating a child with its parent, or creating a parent that starts in
 * the `waiting-children` state).
 */
export type ParentKeyOpts = {
  /**
   * If true, the newly-created parent job will be placed into the parent queue's
   * `waiting-children` state (waiting for children to complete) instead of `wait`.
   */
  addToWaitingChildren?: boolean;
  /** Redis key holding the parent's dependencies set. */
  parentDependenciesKey?: string;
  /** Fully-qualified Redis key of the parent job. */
  parentKey?: string;
};
