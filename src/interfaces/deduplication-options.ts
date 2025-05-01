/**
 * Deduplication options
 */
export interface DeduplicationOptions {
  /**
   * ttl in milliseconds
   */
  ttl?: number;

  /**
   * Identifier
   */
  id: string;

  /**
   * Identifier
   */
  mode?: 'simple';
}
