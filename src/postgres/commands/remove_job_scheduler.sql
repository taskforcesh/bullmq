-- Remove a scheduler and its still-pending job (emitting `removed` events);
-- returns 1 if the scheduler existed, 0 otherwise. Params: $1 queue, $2 id.
SELECT bullmq_remove_job_scheduler($1, $2) AS removed;
