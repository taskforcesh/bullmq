-- Mark an active job failed; returns the finished-at timestamp.
-- Params: $1 queue, $2 id, $3 token, $4 failed_reason, $5 stacktrace (jsonb),
--         $6 finished_on, $7 remove_all, $8 keep_age (s), $9 keep_count.
SELECT bullmq_move_to_failed($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) AS finished_on;
