-- Append a log line at the next per-job ordinal; returns its index.
-- Params: $1 queue, $2 job_id, $3 row.
-- The unqualified table name resolves in the configured BullMQ schema via
-- search_path (default schema: bullmq).
INSERT INTO job_log (queue, job_id, idx, row)
VALUES (
  $1, $2,
  COALESCE(
    (SELECT MAX(idx) + 1 FROM job_log WHERE queue = $1 AND job_id = $2),
    0
  ),
  $3
)
RETURNING idx;
