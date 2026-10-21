-- Removes expired relay nodes and retained messages of every namespace;
-- returns the removed nodes of the given one.
-- Params: $1 namespace, $2 max nodes (and retained messages) to remove.
SELECT relay_sweep AS node_id FROM relay_sweep($1, $2);
