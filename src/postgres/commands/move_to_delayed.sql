-- Re-queue an active job to the delayed state (retry-with-delay / manual delay).
-- Params: $1 queue, $2 id, $3 token, $4 process_at, $5 delay,
--         $6 skip_attempt, $7 failed_reason, $8 stacktrace (jsonb).
SELECT bullmq_move_to_delayed($1, $2, $3, $4, $5, $6, $7, $8::jsonb) AS n;
