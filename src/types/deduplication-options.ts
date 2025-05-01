/**
 * Deduplication options
 */
export type DeduplicationOptions = {
  /**
   * Identifier
   */
  id: string;
} & (
  | {
      /**
       * ttl in milliseconds
       */
      ttl?: number;

      /**
       * Modes
       */
      mode?: 'fixed' | 'sliding';
    }
  | {
      /**
       * Modes
       */
      mode?: 'simple';
    }
);
