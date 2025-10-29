export interface QueueGlobalMeta {
  concurrency?: number;
  max?: number;
  duration?: number;
  maxLenEvents?: number;
  paused?: boolean;
  version?: string;
}
