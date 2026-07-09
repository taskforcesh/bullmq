-- Advance an existing scheduler to its next iteration (no template change);
-- returns the new delayed job id, or NULL if the scheduler is gone.
-- Params: $1 queue, $2 scheduler_id, $3 next_millis, $4 template_data (jsonb),
-- $5 delayed_opts (jsonb), $6 now, $7 producer_id.
SELECT bullmq_update_job_scheduler_next_millis($1, $2, $3, $4, $5, $6, $7) AS job_id;
