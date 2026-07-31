-- One page of a parent's child dependencies in a single status category.
-- Params: $1 parent_queue, $2 parent_id, $3 status, $4 offset, $5 count.
SELECT child_key, value
FROM bullmq_job_dependency
WHERE parent_queue = $1 AND parent_id = $2 AND status = $3::bullmq_dep_status
ORDER BY child_id
OFFSET $4 LIMIT $5;
