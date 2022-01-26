/**
 * KeepJobs
 *
 * Specify which jobs to keep after finishing. If both age and count are
 * specified, then the jobs kept will be the ones that satisfies both
 * properties.
 */
export interface KeepJobs {
  /**
   * Maximum age in seconds for job to be kept.
   */
  age?: number;

  /**
   * Maximum count of jobs to be kept.
   */
  count?: number;
}
