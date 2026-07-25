/**
 * KeepJobs
 *
 * Specify which jobs to keep after finishing. If both age and count are
 * specified, then the jobs kept will be the ones that satisfies both
 * properties.
 *
 * Note that the removal logic is evaluated on a best-effort basis every
 * time a job transitions to the completed/failed set. BullMQ does not
 * run a background timer to evict aged jobs, so a job is only removed
 * once a subsequent job of the same kind (completed or failed) is
 * processed after its age has expired. If no further jobs are
 * processed, previously finished jobs will remain in the set even
 * though their age threshold has been exceeded.
 */
export type KeepJobs =
  | {
      /**
       * Maximum count of jobs to be kept.
       */
      count: number;
    }
  | {
      /**
       * Maximum age **in seconds** for the job to be kept (NOT
       * milliseconds). For example, to keep jobs for 7 days, use
       * `7 * 24 * 60 * 60` (= 604800), not `7 * 24 * 60 * 60 * 1000`.
       *
       * The cleanup is only evaluated when a new job of the same kind
       * (completed or failed) finishes, so a job will only be removed
       * after another job finishes past its expiration time.
       *
       * Values larger than 10 years will trigger a runtime warning,
       * since they almost always indicate a millisecond/second unit
       * mix-up (see issue #3540).
       */
      age: number;

      /**
       * Maximum count of jobs to be kept.
       */
      count?: number;

      /**
       * Maximum quantity of jobs to be removed.
       */
      limit?: number;
    };
