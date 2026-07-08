-- Promote a delayed job to waiting. Params: $1 queue, $2 id.
-- Returns 0 ok, -1 missing, -3 not delayed.
SELECT bullmq_promote($1, $2) AS code;
