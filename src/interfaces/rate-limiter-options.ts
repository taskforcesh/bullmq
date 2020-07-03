export interface RateLimiterOptions {
  // Max number of jobs processed
  max: number;

  // per duration in milliseconds
  duration: number;

  // grouping path key in job data
  groupKey?: string;
}
