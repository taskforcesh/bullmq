-- Pause/resume the queue. Params: $1 queue, $2 paused.
SELECT bullmq_pause($1, $2);
