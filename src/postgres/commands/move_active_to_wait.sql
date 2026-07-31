-- Move an active job back to wait (Job.moveToWait / dynamic rate limit).
-- Params: $1 queue, $2 id, $3 token ('0' bypasses the lock check), $4 now_ms.
-- Returns the limiter window ms (>=0), or -1 when the job no longer exists.
SELECT bullmq_move_active_to_wait($1, $2, $3, $4) AS n;
