-- Break a child's dependency link to its parent. Params: $1 queue, $2 job_id,
-- $3 parent_key, $4 now. Returns 0 (removed) or 1 (no relationship); raises on
-- missing job (-1) / missing parent (-5).
SELECT bullmq_remove_child_dependency($1, $2, $3, $4) AS n;
