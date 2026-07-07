-- Child-dependency counts per status for a parent job.
-- Params: $1 parent_queue, $2 parent_id. ("unprocessed" = pending children.)
SELECT
  COUNT(*) FILTER (WHERE status = 'processed') AS processed,
  COUNT(*) FILTER (WHERE status = 'pending')   AS unprocessed,
  COUNT(*) FILTER (WHERE status = 'ignored')   AS ignored,
  COUNT(*) FILTER (WHERE status = 'failed')    AS failed
FROM bullmq_job_dependency
WHERE parent_queue = $1 AND parent_id = $2;
