-- Register/update a scheduler and enqueue its next iteration; returns the
-- delayed job id and its delay. Params: $1 queue, $2 scheduler_id,
-- $3 next_millis, $4 template_data (jsonb), $5 template_opts (jsonb),
-- $6 opts (jsonb), $7 delayed_opts (jsonb), $8 now, $9 producer_id.
SELECT job_id, delay
  FROM bullmq_add_job_scheduler($1, $2, $3, $4, $5, $6, $7, $8, $9);
