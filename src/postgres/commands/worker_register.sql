-- Registers (or refreshes) a Worker, its lease and its info.
-- Params: $1 queue, $2 Worker id, $3 lease (ms), $4 info (JSON).
SELECT worker_register($1, $2, $3, $4::jsonb);
