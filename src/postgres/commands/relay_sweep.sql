-- Removes relay nodes whose lease expired, and expired retained messages.
-- Params: $1 namespace, $2 max nodes to remove.
SELECT relay_sweep AS node_id FROM relay_sweep($1, $2);
