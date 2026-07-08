-- Two-phase stalled-job recovery (mark on one pass, reclaim on the next);
-- returns the reclaimed ids. Params: $1 queue, $2 max_stalled_count,
-- $3 now_ms, $4 max_check_time_ms (stalledInterval).
SELECT id FROM bullmq_move_stalled_jobs_to_wait($1, $2, $3, $4) AS t(id);
