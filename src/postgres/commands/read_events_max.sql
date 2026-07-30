-- The current max event id for a queue (used to resolve the '$' cursor).
-- Param: $1 queue.
SELECT COALESCE(MAX(id), 0)::bigint AS max FROM bullmq_event WHERE queue = $1;
