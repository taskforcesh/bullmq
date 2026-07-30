-- Clear the limiter window; returns the number of rows removed (0 or 1).
-- Param: $1 queue.
WITH d AS (
  DELETE FROM bullmq_rate_limit WHERE queue = $1 RETURNING 1
)
SELECT count(*)::int AS n FROM d;
