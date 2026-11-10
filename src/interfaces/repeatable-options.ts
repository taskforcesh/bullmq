export type RepeatableOptions = {
  name: string;
  /**
   * Seed for the scheduler iteration count. It is only applied when the
   * scheduler record is created (first upsert or after removal); upserting
   * an existing scheduler keeps its current iteration count.
   */
  count?: number;
  startDate?: number;
  endDate?: number;
  tz?: string;
  limit?: number;
  pattern?: string;
  every?: number;
  offset?: number;
};
