-- Fetch a page of schedulers ordered by next-run time. Params: $1 queue,
-- $2 asc (boolean), $3 offset, $4 count (NULL = all remaining).
SELECT scheduler_id, next_run_ms
  FROM bullmq_scheduler
 WHERE queue = $1
 ORDER BY CASE WHEN $2 THEN next_run_ms END ASC,
          CASE WHEN NOT $2 THEN next_run_ms END DESC,
          scheduler_id
 OFFSET $3
 LIMIT $4;
