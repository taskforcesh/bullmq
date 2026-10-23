-- Removes expired Workers of every queue; returns the removed Workers of the
-- given one.
-- Params: $1 queue, $2 max Workers to remove.
SELECT worker_sweep AS worker_id FROM worker_sweep($1, $2);
