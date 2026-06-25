import { JobProgress } from '../types/job-progress';
import { JobsOptions } from '../types/job-options';
import { ParentKeys } from './parent';

export interface JobJson {
  id: string;
  name: string;
  data: string;
  opts: JobsOptions;
  progress: JobProgress;
  attemptsMade: number;
  attemptsStarted: number;
  finishedOn?: number;
  processedOn?: number;
  timestamp: number;
  delay?: number;
  priority?: number;
  failedReason: string;
  stacktrace?: string;
  returnvalue: string;
  parent?: ParentKeys;
  parentKey?: string;
  repeatJobKey?: string;
  nextRepeatableJobId?: string;
  debounceId?: string;
  deduplicationId?: string;
  deferredFailure?: string;
  processedBy?: string;
  stalledCounter: number;
}
