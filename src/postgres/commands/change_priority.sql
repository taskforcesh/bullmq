-- Change a job's priority (and reposition via lifo). Params: $1 queue, $2 id,
-- $3 priority, $4 lifo. Returns 0 ok, -1 missing.
SELECT bullmq_change_priority($1, $2, $3, $4) AS code;
