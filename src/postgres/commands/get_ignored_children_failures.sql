-- Ignored children of a parent as (child_key → failure reason) pairs. The reason
-- is stored as a JSON scalar string, so `#>> '{}'` extracts the raw text
-- (mirrors the Redis `<jobId>:failed` hash). Params: $1 parent_queue, $2 parent_id.
SELECT child_key, COALESCE(value #>> '{}', value::text) AS reason
FROM bullmq_job_dependency
WHERE parent_queue = $1 AND parent_id = $2 AND status = 'ignored'
ORDER BY child_id;
