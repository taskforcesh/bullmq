-- Upsert queue metadata fields. Params: $1 queue, $2 fields (text[]), $3 values (text[]).
INSERT INTO bullmq_meta (queue, field, value)
SELECT $1, f, v FROM unnest($2::text[], $3::text[]) AS t(f, v)
ON CONFLICT (queue, field) DO UPDATE SET value = EXCLUDED.value;
