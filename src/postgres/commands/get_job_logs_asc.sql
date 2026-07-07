-- A page of a job's logs, oldest first.
-- Params: $1 queue, $2 job_id, $3 offset, $4 limit.
SELECT row FROM bullmq_job_log
 WHERE queue = $1 AND job_id = $2
 ORDER BY idx ASC
 OFFSET $3 LIMIT $4;
