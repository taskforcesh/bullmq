-- Job counts by state for a queue. Param: $1 queue.
-- "prioritized" = waiting with priority > 0; "waiting" = waiting with priority 0.
SELECT
  COUNT(*) FILTER (WHERE state = 'active')                   AS active,
  COUNT(*) FILTER (WHERE state = 'completed')                AS completed,
  COUNT(*) FILTER (WHERE state = 'failed')                   AS failed,
  COUNT(*) FILTER (WHERE state = 'delayed')                  AS delayed,
  COUNT(*) FILTER (WHERE state = 'waiting' AND priority = 0) AS waiting,
  COUNT(*) FILTER (WHERE state = 'waiting' AND priority > 0) AS prioritized,
  COUNT(*) FILTER (WHERE state = 'waiting-children')         AS "waiting-children",
  (SELECT value FROM bullmq_meta WHERE queue = $1 AND field = 'paused') AS paused
FROM bullmq_job
WHERE queue = $1;
