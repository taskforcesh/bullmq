-- Fetch a single scheduler's stored metadata and next-run score.
-- Params: $1 queue, $2 scheduler_id.
SELECT name, iteration_count, limit_count, start_date_ms, end_date_ms, tz,
       pattern, every_ms, offset_ms, template_data, template_opts, next_run_ms
  FROM bullmq_scheduler
 WHERE queue = $1 AND scheduler_id = $2;
