-- Obliterate a queue: delete up to $2 jobs; returns -1 (not paused), -2 (active
-- jobs without force), 1 (more to delete), or 0 (done). Params: $1 queue,
-- $2 count, $3 force.
SELECT bullmq_obliterate($1, $2, $3) AS cursor;
