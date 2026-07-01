-- A job's full row. Params: $1 queue, $2 id.
SELECT * FROM bullmq_job WHERE queue = $1 AND id = $2;
