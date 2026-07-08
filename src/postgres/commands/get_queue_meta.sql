-- The full queue metadata hash. Param: $1 queue.
SELECT field, value FROM bullmq_meta WHERE queue = $1;
