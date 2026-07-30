-- Whether the queue is "maxed": it has a global concurrency limit and the
-- number of active jobs has reached it (mirrors isQueueMaxed). Returns false
-- when no concurrency limit is configured.
-- Params: $1 queue.
SELECT COALESCE(
  (SELECT count(*) FROM bullmq_job WHERE queue = $1 AND state = 'active')
    >= (SELECT value::integer FROM bullmq_meta
         WHERE queue = $1 AND field = 'concurrency'),
  false
) AS maxed;
