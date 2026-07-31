-- Re-queue a finished job (failed/completed) back to wait. Params: $1 queue,
-- $2 id, $3 state, $4 lifo, $5 reset_attempts_made, $6 reset_attempts_started.
-- Returns 1 ok, -1 missing, -3 not in the expected state.
SELECT bullmq_reprocess_job($1, $2, $3, $4, $5, $6) AS code;
