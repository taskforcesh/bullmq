-- Append a log line at the next per-job ordinal; returns its index.
-- Params: $1 queue, $2 job_id, $3 row.
-- The unqualified table name resolves in the configured BullMQ schema via
-- search_path (default schema: bullmq).
WITH per_job_lock AS (
  SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))
)
INSERT INTO job_log (queue, job_id, idx, row)
SELECT
  $1, $2,
  COALESCE(
    (SELECT MAX(idx) + 1 FROM job_log WHERE queue = $1 AND job_id = $2),
    0
  ),
  $3
FROM per_job_lock
RETURNING idx;
