import { FinishedTarget } from './finished-target';

export type JobState =
  | FinishedTarget
  | 'active'
  | 'delayed'
  | 'waiting'
  | 'waiting-children';

export type JobType = JobState | 'paused' | 'repeat' | 'wait';
