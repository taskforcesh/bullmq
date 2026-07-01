-- Per-minute metrics for a queue/kind, newest bucket first and sliced to
-- [start, end] using Redis LRANGE semantics (index 0 is the newest point,
-- a negative end means "to the oldest"). Params: $1 queue, $2 kind
-- ('completed' | 'failed'), $3 start, $4 end. Returns the cumulative total
-- (mirrors the Redis metrics meta `count`) and the sliced data points.
WITH ordered AS (
  SELECT count, ROW_NUMBER() OVER (ORDER BY bucket_min DESC) - 1 AS idx
    FROM bullmq_metrics
   WHERE queue = $1 AND kind = $2
)
SELECT
  COALESCE(
    (SELECT SUM(count) FROM bullmq_metrics WHERE queue = $1 AND kind = $2),
    0
  )::bigint AS total,
  COALESCE(
    array_agg(count ORDER BY idx) FILTER (
      WHERE idx >= $3 AND ($4 < 0 OR idx <= $4)
    ),
    ARRAY[]::bigint[]
  ) AS data
FROM ordered;
