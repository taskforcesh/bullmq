-- Subscriptions of a relay namespace, optionally of a node or a pattern.
-- Params: $1 namespace, $2 node id (or NULL), $3 pattern (or NULL), $4 start,
-- $5 end (inclusive, -1: to the end).
SELECT node_id, endpoint_id, pattern
  FROM relay_get_subscriptions($1, $2, $3, $4, $5);
