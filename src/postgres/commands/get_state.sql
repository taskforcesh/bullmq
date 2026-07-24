-- A job's state and priority. Params: $1 queue, $2 id.
SELECT state, priority FROM bullmq_job WHERE queue = $1 AND id = $2;
