-- Conditionally remove a deduplication key, only when the given job is still
-- its (live) winner (mirrors removeDeduplicationKeyIfNeededOnRemoval and the
-- job-instance Job.removeDeduplicationKey, where Redis GET returns nil for an
-- expired key). Params: $1 queue, $2 dedup_id, $3 job_id, $4 now (ms). Returns
-- the removed key (0 or 1 row).
DELETE FROM bullmq_dedup
WHERE queue = $1 AND dedup_id = $2 AND job_id = $3
  AND (expire_at_ms IS NULL OR expire_at_ms > $4)
RETURNING dedup_id;
