-- Ready-timestamp of the oldest pending job for a queue. Param: $1 queue.
-- A delayed job's ready-timestamp is process_at_ms (when its delay elapses);
-- for anything else (including prioritized jobs - priority isn't stored in
-- a separate structure here the way it is in Redis) it's added_at_ms.
SELECT MIN(
  CASE WHEN state = 'delayed' THEN process_at_ms ELSE added_at_ms END
) AS oldest
FROM job
WHERE queue = $1
  AND (state = 'waiting' OR state = 'delayed');
