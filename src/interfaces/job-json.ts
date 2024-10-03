import { RedisJobOptions } from '../types';
import { ParentKeys } from './parent';

export interface JobJson {
  id: string;
  name: string;
  data: string;
  opts: RedisJobOptions;
  progress: number | object;
  attemptsMade: number;
  attemptsStarted: number;
  finishedOn?: number;
  processedOn?: number;
  timestamp: number;
  failedReason: string;
  stacktrace: string;
  returnvalue: string;
  parent?: ParentKeys;
  parentKey?: string;
  repeatJobKey?: string;
  debounceId?: string;
  deduplicationId?: string;
  processedBy?: string;
}

export interface JobJsonRaw {
  id: string;
  name: string;
  data: string;
  delay: string;
  opts: string;
  progress: string;
  attemptsMade?: string;
  finishedOn?: string;
  processedOn?: string;
  timestamp: string;
  failedReason: string;
  stacktrace: string[];
  returnvalue: string;
  parentKey?: string;
  parent?: string;
  deid?: string;
  rjk?: string;
  atm?: string;
  ats?: string;
  pb?: string; // Worker name
}
