-- Trim a job's oldest logs. Params: $1 queue, $2 job_id, $3 min_idx_to_keep.
DELETE FROM bullmq_job_log
 WHERE queue = $1 AND job_id = $2 AND idx < $3;
