-- The current "winner" job id for a deduplication key, or none when absent or
-- expired. Params: $1 queue, $2 dedup_id, $3 now (ms).
SELECT job_id
FROM bullmq_dedup
WHERE queue = $1
  AND dedup_id = $2
  AND (expire_at_ms IS NULL OR expire_at_ms > $3);
