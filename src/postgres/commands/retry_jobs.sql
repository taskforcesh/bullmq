-- Move up to `count` finished jobs back to waiting; returns the number moved.
-- Params: $1 queue, $2 state, $3 count, $4 timestamp.
SELECT bullmq_retry_jobs($1, $2, $3, $4) AS n;
