-- Total number of log lines for a job. Params: $1 queue, $2 job_id.
SELECT COUNT(*) AS count FROM job_log WHERE queue = $1 AND job_id = $2;
