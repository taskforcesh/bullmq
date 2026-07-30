-- Refresh an active job's lock; returns 1 on success, 0 if the lock was lost.
-- Params: $1 queue, $2 id, $3 token, $4 lock_ms, $5 now_ms.
SELECT bullmq_extend_lock($1, $2, $3, $4, $5) AS n;
