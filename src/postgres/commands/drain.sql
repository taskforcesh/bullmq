-- Remove waiting (and optionally delayed) jobs. Params: $1 queue, $2 delayed.
SELECT bullmq_drain($1, $2);
