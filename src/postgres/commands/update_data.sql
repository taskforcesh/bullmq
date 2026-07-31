-- Replace a job's data payload. Params: $1 queue, $2 id, $3 data (jsonb).
UPDATE bullmq_job SET data = $3::jsonb WHERE queue = $1 AND id = $2
RETURNING id;
