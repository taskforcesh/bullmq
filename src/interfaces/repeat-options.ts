import { ParserOptions } from 'cron-parser';

/**
 * Settings for repeatable jobs
 *
 * @see {@link https://docs.bullmq.io/guide/jobs/repeatable}
 */
export interface RepeatOptions extends Omit<ParserOptions, 'iterator'> {
  /**
   * A repeat pattern
   */
  pattern?: string;

  /**
   * Custom repeatable key. This is the key that holds the "metadata"
   * of a given repeatable job. This key is normally auto-generated but
   * it is sometimes useful to specify a custom key for easier retrieval
   * of repeatable jobs.
   */
  key?: string;

  /**
   * Number of times the job should repeat at max.
   */
  limit?: number;
  /**
   * Repeat after this amount of milliseconds
   * (`pattern` setting cannot be used together with this setting.)
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
