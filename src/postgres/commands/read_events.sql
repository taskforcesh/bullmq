-- A page of events newer than a cursor, oldest first.
-- Params: $1 queue, $2 cursor (exclusive), $3 limit.
SELECT id, event, data FROM bullmq_event
 WHERE queue = $1 AND id > $2
 ORDER BY id ASC
 LIMIT $3;
