-- Delayed jobs scheduled strictly before $2 (Unix milliseconds). $1 is queue.
SELECT COUNT(*) AS count
FROM job
WHERE queue = $1 AND state = 'delayed' AND process_at_ms < $2::bigint;
