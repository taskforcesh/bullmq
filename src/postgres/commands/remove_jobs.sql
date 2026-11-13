-- Remove several jobs at once. Returns the ids that were removed.
-- Params: $1 queue, $2 ids (text[]), $3 remove_children.
SELECT remove_jobs($1, $2::text[], $3) AS id;
