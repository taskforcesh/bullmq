-- Append a custom event to the stream; returns the event id.
-- Params: $1 queue, $2 event, $3 data (jsonb).
SELECT bullmq_publish_event($1, $2, $3::jsonb) AS id;
