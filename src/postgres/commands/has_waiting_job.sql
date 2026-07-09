-- Whether the queue has a claimable (waiting, non-paused) job right now. Used
-- by waitForJob to close the race where a NOTIFY fires before the listener is
-- established (mirrors the atomicity of Redis's blocking pop). Param: $1 queue.
SELECT
  EXISTS(
    SELECT 1 FROM bullmq_job WHERE queue = $1 AND state = 'waiting'
  )
  AND NOT EXISTS(
    SELECT 1 FROM bullmq_meta
     WHERE queue = $1 AND field = 'paused' AND value = '1'
  ) AS present;
