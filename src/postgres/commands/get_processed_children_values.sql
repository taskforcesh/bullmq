-- Processed children of a parent as (child_key → serialized value) pairs. The
-- value is returned as JSON text so the caller can JSON.parse it (mirrors the
-- Redis `<jobId>:processed` hash of stringified values). Params: $1 parent_queue,
-- $2 parent_id.
SELECT child_key, value::text AS value
FROM bullmq_job_dependency
WHERE parent_queue = $1 AND parent_id = $2 AND status = 'processed'
ORDER BY child_id;
