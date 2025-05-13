/**
 * Deduplication options
 */
export type DeduplicationOptions = {
  /**
   * Identifier
   */
  id: string;
} & {
  /**
   * ttl in milliseconds
   */
  ttl?: number;

  /**
   * Extend ttl value
   */
  extend?: boolean;

  /**
   * replace job record while it's in delayed state
   */
  replace?: boolean;
};
