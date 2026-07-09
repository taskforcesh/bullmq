-- Re-queue an active job back to waiting immediately (retry now).
-- Params: $1 queue, $2 id, $3 token, $4 lifo, $5 failed_reason, $6 stacktrace (jsonb).
SELECT bullmq_retry_job($1, $2, $3, $4, $5, $6::jsonb) AS n;
