-- Removes every subscription of a relay endpoint.
-- Params: $1 namespace, $2 node id, $3 endpoint id.
SELECT relay_remove_endpoint($1, $2, $3) AS removed;
