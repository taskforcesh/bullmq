export interface QueueMeta {
  concurrency?: number;
  max?: number;
  duration?: number;
  maxLenEvents?: number;
  paused?: boolean;
  version?: string;
}
