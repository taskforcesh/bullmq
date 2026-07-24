-- All of a parent job's child dependencies with their status and stored value.
-- Params: $1 parent_queue, $2 parent_id. Status maps to the public categories:
-- processed → processed (value = return value), pending → unprocessed,
-- ignored → ignored (value = reason), failed → failed.
SELECT status::text AS status, child_key, value
FROM bullmq_job_dependency
WHERE parent_queue = $1 AND parent_id = $2
ORDER BY child_id;
