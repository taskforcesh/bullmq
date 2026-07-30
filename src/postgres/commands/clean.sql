-- Remove jobs of a state older than a timestamp, up to a limit (0 = all);
-- returns removed ids. Params: $1 queue, $2 type, $3 timestamp, $4 limit.
SELECT id FROM bullmq_clean($1, $2, $3, $4) AS t(id);
