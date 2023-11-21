import { FinishedStatus } from './finished-status';

export type JobState =
  | FinishedStatus
  | 'active'
  | 'delayed'
  | 'prioritized'
  | 'waiting'
  | 'waiting-children';

export type JobType = JobState | 'paused' | 'repeat' | 'wait';
