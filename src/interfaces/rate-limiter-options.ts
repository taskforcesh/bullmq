interface Rate {
  max: number;
  duration: number;
}

export interface GroupRates {
  [key: string]: Rate;
}

export interface RateLimiterOptions {
  // Max number of jobs processed
  max: number;

  // per duration in milliseconds
  duration: number;

  // grouping path key in job data
  groupKey?: string;

  // optional rate limits defined per groupKey
  groupRates?: GroupRates;
}
