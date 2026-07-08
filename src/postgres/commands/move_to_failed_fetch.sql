-- Fail (or retry) an active job AND claim the next ready job in one transaction
-- (one commit) — the fused equivalent of move_to_failed followed by
-- move_to_active, mirroring Redis's moveToFinished. Returns 0 or 1 job rows.
-- Params: $1 queue, $2 id, $3 token, $4 failed_reason, $5 stacktrace (jsonb),
--         $6 finished_on, $7 remove_all, $8 keep_age (s), $9 keep_count,
--         $10 lock_ms, $11 now_ms, $12 worker name,
--         $13 limiter max (worker option, NULL if none), $14 limiter duration ms.
SELECT * FROM bullmq_move_to_failed_fetch(
  $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14);
