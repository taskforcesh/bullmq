-- Live Workers of a queue, by registration.
-- Params: $1 queue.
SELECT worker_id, registered_at, lease_until, info, last_heartbeat
  FROM worker_list($1);
