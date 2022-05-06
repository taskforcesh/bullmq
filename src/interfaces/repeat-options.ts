import { ParserOptions } from 'cron-parser';

/**
 * Settings for repeatable jobs
 *
 * @see {@link https://docs.bullmq.io/guide/jobs/repeatable}
 */
export interface RepeatOptions extends Omit<ParserOptions, 'iterator'> {
  /**
   * A cron pattern
   */
  cron?: string;
  /**
   * Number of times the job should repeat at max.
   */
  limit?: number;
  /**
   * Repeat after this amount of milliseconds
   * (`cron` setting cannot be used together with this setting.)
   */
  every?: number;
  /**
   * Repeated job should start right now
   * ( work only with every settings)
   */
  immediately?: boolean;
  /**
   * The start value for the repeat iteration count.
   */
  count?: number;
  prevMillis?: number;
  offset?: number;
  jobId?: string;
}
