export interface RateLimiterOpts {
  // Max number of jobs processed
  max: number;

  // per duration in milliseconds
  duration: number;

  // When jobs get rate limited, they stay in the waiting
  // queue and are not moved to the delayed queue
  bounceBack?: boolean;
}
