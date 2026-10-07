-- Registers (or refreshes) a relay node and its lease.
-- Params: $1 namespace, $2 node id, $3 lease (ms).
SELECT relay_register_node($1, $2, $3);
