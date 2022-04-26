import { RepeatOptionsBase } from '../interfaces';

export type RepeatOptions = RepeatOptionsBase & {
  /**
   * Base repeat job key.
   */
  repeatJobKey?: string;
};

/**
 * These fields are the ones stored in Redis with smaller keys for compactness.
 */
export type RedisRepeatOptions = RepeatOptionsBase & {
  /**
   * Base repeat job key.
   */
  rjk?: string;
};
