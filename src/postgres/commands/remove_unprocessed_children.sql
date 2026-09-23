-- Recursively remove a parent's still-pending children. Params: $1 queue,
-- $2 job_id.
SELECT remove_unprocessed_children($1, $2);
