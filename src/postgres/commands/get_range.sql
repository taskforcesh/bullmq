-- Job ids in a state, sliced by [start, end]. Params: $1 queue, $2 type,
-- $3 start, $4 end, $5 asc.
SELECT id FROM bullmq_get_range($1, $2, $3, $4, $5) AS t(id);
