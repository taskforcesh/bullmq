-- Remove a job (and optionally its children). Returns 1 if removed, else 0.
-- Params: $1 queue, $2 id, $3 remove_children.
SELECT bullmq_remove($1, $2, $3) AS n;
