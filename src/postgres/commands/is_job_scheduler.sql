-- Whether an id corresponds to a registered scheduler. Params: $1 queue, $2 id.
SELECT EXISTS (
  SELECT 1 FROM bullmq_scheduler WHERE queue = $1 AND scheduler_id = $2
) AS exists;
