-- Renews a relay node's lease; false when the node must register again.
-- Params: $1 namespace, $2 node id, $3 lease (ms).
SELECT relay_heartbeat($1, $2, $3) AS alive;
