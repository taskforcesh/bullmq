-- The full queue metadata hash. Param: $1 queue.
SELECT field, value FROM meta WHERE queue = $1;
