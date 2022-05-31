import { FinishedStatus } from './finished-status';

export type JobState =
  | FinishedStatus
  | 'active'
  | 'delayed'
  | 'waiting'
  | 'waiting-children';

export type JobType = JobState | 'paused' | 'repeat' | 'wait';
