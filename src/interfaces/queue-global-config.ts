export interface QueueGlobalConfig {
  concurrency?: number;
  max?: number;
  duration?: number;
  maxLenEvents?: number;
  paused?: boolean;
  version?: string;
}
