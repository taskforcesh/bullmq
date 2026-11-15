-- Remove jobs of a state older than a timestamp, optionally matching name,
-- up to a limit (0 = all); returns removed ids.
-- Params: $1 queue, $2 type, $3 timestamp, $4 limit, $5 name (nullable).
SELECT id FROM clean($1, $2, $3, $4, $5) AS t(id);
