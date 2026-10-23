-- Renews a Worker's lease; false when the Worker must register again.
-- Params: $1 queue, $2 Worker id, $3 lease (ms).
SELECT worker_heartbeat($1, $2, $3) AS alive;
