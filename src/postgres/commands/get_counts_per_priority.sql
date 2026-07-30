-- Waiting-job counts per priority. Params: $1 queue, $2 priorities (bigint[]).
-- Returns one row per requested priority, in the input array order, with the
-- number of waiting jobs at that priority. Pausing is an O(1) meta flag that
-- leaves jobs in the 'waiting' state, so the counts are identical whether or
-- not the queue is paused (mirrors Redis, where pausing does not touch the
-- wait/prioritized sets).
SELECT COUNT(j.id) AS cnt
FROM unnest($2::bigint[]) WITH ORDINALITY AS pr(priority, ord)
LEFT JOIN bullmq_job j
  ON j.queue = $1
 AND j.state = 'waiting'
 AND j.priority = pr.priority
GROUP BY pr.ord
ORDER BY pr.ord;
