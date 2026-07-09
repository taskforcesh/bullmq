-- Update a job's progress and emit a 'progress' event. Returns the number of
-- rows updated (0 = missing job). Params: $1 queue, $2 id, $3 progress (jsonb).
SELECT bullmq_update_progress($1, $2, $3::jsonb) AS updated;
