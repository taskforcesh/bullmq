export type JobState =
  | 'active'
  | 'completed'
  | 'delayed'
  | 'failed'
  | 'waiting'
  | 'waiting-children';

export type JobType = JobState | 'paused' | 'repeat' | 'wait';
