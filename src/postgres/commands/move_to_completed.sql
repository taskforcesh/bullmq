-- Finish an active job successfully; returns the finished-at timestamp.
-- Params: $1 queue, $2 id, $3 token, $4 return_value (jsonb), $5 finished_on,
--         $6 remove_all, $7 keep_age (s), $8 keep_count.
SELECT bullmq_move_to_completed($1, $2, $3, $4::jsonb, $5, $6, $7, $8) AS finished_on;
