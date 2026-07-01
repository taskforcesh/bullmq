-- A parent job's child dependencies of a given status, sliced [offset, limit]
-- and joined to the child job rows (for fetchJobs). Params: $1 parent_queue,
-- $2 parent_id, $3 status ('pending' | 'processed'), $4 offset, $5 limit
-- (NULL = no limit). `total` is the full number of matching dependencies
-- (COUNT(*) OVER(), computed before the slice). `dep_value` is the stored
-- result for processed children. The remaining columns are the child
-- `bullmq_job` row consumed by rowToJobJson.
SELECT
  d.child_key,
  d.value AS dep_value,
  COUNT(*) OVER() AS total,
  j.*
FROM bullmq_job_dependency d
LEFT JOIN bullmq_job j
  ON j.queue = d.child_queue AND j.id = d.child_id
WHERE d.parent_queue = $1 AND d.parent_id = $2 AND d.status = $3::bullmq_dep_status
ORDER BY d.child_key
OFFSET $4
LIMIT $5;
