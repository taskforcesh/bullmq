-- Whether the queue has a claimable job right now: a waiting job while the
-- queue is neither paused nor maxed (at its global concurrency limit), the same
-- condition under which Redis adds a marker (isQueuePausedOrMaxed). Used by
-- waitForJob to close the race where a NOTIFY fires before the listener is
-- established (mirrors the atomicity of Redis's blocking pop) without waking a
-- worker that move_to_active would turn away. Param: $1 queue.
SELECT
  EXISTS(
    SELECT 1 FROM job WHERE queue = $1 AND state = 'waiting'
  )
  AND NOT EXISTS(
    SELECT 1 FROM meta
     WHERE queue = $1 AND field = 'paused' AND value = '1'
  )
  AND NOT EXISTS(
    SELECT 1 FROM meta
     WHERE queue = $1 AND field = 'concurrency'
       AND (SELECT count(*) FROM job WHERE queue = $1 AND state = 'active')
           >= value::integer
  ) AS present;
