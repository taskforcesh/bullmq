-- Reschedule a delayed job. Params: $1 queue, $2 id, $3 delay, $4 now.
-- Returns 0 ok, -1 missing, -3 not delayed.
SELECT bullmq_change_delay($1, $2, $3, $4) AS code;
