-- Nodes of a relay namespace, by registration.
-- Params: $1 namespace, $2 start, $3 end (inclusive, -1: to the end).
SELECT node_id, registered_at, lease_until, info, last_heartbeat, backlog,
       dropped, subscriptions
  FROM relay_get_nodes($1, $2, $3);
