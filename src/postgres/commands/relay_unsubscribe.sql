-- Unsubscribes a relay endpoint from a pattern.
-- Params: $1 namespace, $2 node id, $3 endpoint id, $4 pattern.
SELECT relay_unsubscribe($1, $2, $3, $4) AS removed;
