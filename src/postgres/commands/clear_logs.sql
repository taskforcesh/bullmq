-- Clear a job's logs, keeping the latest $3 entries (NULL/0 → remove all).
-- Params: $1 queue, $2 job_id, $3 keepLogs.
DELETE FROM bullmq_job_log
 WHERE queue = $1 AND job_id = $2
   AND idx < COALESCE(
     (SELECT MAX(idx) FROM bullmq_job_log WHERE queue = $1 AND job_id = $2)
       - $3 + 1,
     idx + 1
   );
