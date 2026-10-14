-- Registers (or refreshes) a relay node, its lease and its info.
-- Params: $1 namespace, $2 node id, $3 lease (ms), $4 info (JSON).
SELECT relay_register_node($1, $2, $3, $4::jsonb);
