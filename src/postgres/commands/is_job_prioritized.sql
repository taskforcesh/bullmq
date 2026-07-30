-- Whether a job is prioritized (waiting with a non-zero priority).
-- Params: $1 queue, $2 id.
SELECT EXISTS(
  SELECT 1 FROM bullmq_job
   WHERE queue = $1 AND id = $2 AND state = 'waiting' AND priority > 0
) AS present;
