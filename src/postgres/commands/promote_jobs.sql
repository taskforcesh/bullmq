-- Move up to `count` delayed jobs to waiting; returns the number moved.
-- Params: $1 queue, $2 count.
SELECT bullmq_promote_jobs($1, $2) AS n;
