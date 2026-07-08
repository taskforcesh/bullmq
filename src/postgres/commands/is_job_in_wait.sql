-- Whether a (non-prioritized) waiting job is in the wait or paused list. The
-- queue has no separate paused list: a waiting job belongs to the paused list
-- when the queue is paused, and to the wait list otherwise. $3 selects which
-- list to test (true = paused, false = wait). Params: $1 queue, $2 id, $3 paused.
SELECT EXISTS(
  SELECT 1 FROM bullmq_job j
   WHERE j.queue = $1 AND j.id = $2
     AND j.state = 'waiting' AND j.priority = 0
     AND (
       EXISTS(
         SELECT 1 FROM bullmq_meta m
          WHERE m.queue = $1 AND m.field = 'paused' AND m.value = '1'
       )
     ) = $3
) AS present;
