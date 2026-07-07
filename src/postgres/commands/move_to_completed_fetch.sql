-- Finish an active job successfully AND claim the next ready job in one
-- transaction (one commit) — the fused equivalent of move_to_completed followed
-- by move_to_active, mirroring Redis's moveToFinished. Returns 0 or 1 job rows.
-- Params: $1 queue, $2 id, $3 token, $4 return_value (jsonb), $5 finished_on,
--         $6 remove_all, $7 keep_age (s), $8 keep_count,
--         $9 lock_ms, $10 now_ms, $11 worker name,
--         $12 limiter max (worker option, NULL if none), $13 limiter duration ms.
SELECT * FROM bullmq_move_to_completed_fetch(
  $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13);
