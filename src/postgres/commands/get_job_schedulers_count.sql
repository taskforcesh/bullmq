-- Number of registered schedulers in a queue. Param: $1 queue.
SELECT count(*)::int AS count FROM bullmq_scheduler WHERE queue = $1;
