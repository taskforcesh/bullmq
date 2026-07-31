-- Whether a job is currently in the given state. Params: $1 queue, $2 id,
-- $3 state.
SELECT EXISTS(
  SELECT 1 FROM bullmq_job
   WHERE queue = $1 AND id = $2 AND state = $3::bullmq_job_state
) AS present;
