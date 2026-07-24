-- Fast set-based bulk insert of INDEPENDENT jobs (no parents, no dedup).
-- Param: $1 queue, $2 entries (jsonb array). Returns the job ids in input order.
SELECT id FROM bullmq_add_jobs_bulk($1, $2::jsonb) AS t(id);
