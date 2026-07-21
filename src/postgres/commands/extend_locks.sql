-- Refresh multiple active-job locks in one round-trip; returns the ids whose
-- locks could not be renewed. Params: $1 queue, $2 ids (text[]), $3 tokens
-- (text[]), $4 lock_ms, $5 now_ms.
WITH input AS (
  SELECT ids.job_id, toks.token, ids.ord
    FROM unnest($2::text[]) WITH ORDINALITY AS ids(job_id, ord)
    JOIN unnest($3::text[]) WITH ORDINALITY AS toks(token, ord)
      USING (ord)
),
updated AS (
  UPDATE bullmq_job
     SET locked_until_ms = $5 + $4
    FROM input
   WHERE queue = $1
     AND id = input.job_id
     AND state = 'active'
     AND lock_token = input.token
  RETURNING id
)
SELECT input.job_id AS id
  FROM input
  LEFT JOIN updated
    ON updated.id = input.job_id
 WHERE updated.id IS NULL
 ORDER BY input.ord;
