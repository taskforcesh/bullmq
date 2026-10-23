-- Unregisters a Worker.
-- Params: $1 queue, $2 Worker id.
SELECT worker_unregister($1, $2) AS removed;
