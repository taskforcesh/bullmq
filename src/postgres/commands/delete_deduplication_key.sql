-- Unconditionally remove a deduplication key (Queue.removeDeduplicationKey /
-- the deprecated removeDebounceKey). Params: $1 queue, $2 dedup_id. Returns the
-- removed key (0 or 1 row).
DELETE FROM bullmq_dedup
WHERE queue = $1 AND dedup_id = $2
RETURNING dedup_id;
