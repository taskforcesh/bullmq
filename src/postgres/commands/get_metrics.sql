-- Metrics for a queue/kind: the meta (`count`, `prev_ts`, `prev_count`) and the
-- per-minute data points (newest first), sliced to [start, end] with Redis
-- LRANGE semantics: index 0 is the newest point and a negative index counts
-- from the oldest (-1 is the oldest point, -2 the one before it).
-- `num_points` is the length of the whole series, not of the slice, like LLEN
-- in getMetrics-2.lua.
-- Params: $1 queue, $2 kind ('completed' | 'failed'), $3 start, $4 end.
WITH series AS (
  SELECT count, prev_ts, prev_count, data, cardinality(data) AS num_points
    FROM metrics
   WHERE queue = $1 AND kind = $2
), bounds AS (
  -- Arrays are 1-based, hence the + 1. A start before the first point is
  -- clamped to it; an empty or inverted range yields an empty array.
  SELECT (CASE WHEN $3 < 0 THEN GREATEST(num_points + $3, 0) ELSE $3 END) + 1 AS first_index,
         (CASE WHEN $4 < 0 THEN num_points + $4 ELSE $4 END) + 1 AS last_index
    FROM series
)
SELECT
  COALESCE((SELECT count FROM series), 0)::bigint AS total,
  COALESCE((SELECT prev_ts FROM series), 0)::bigint AS prev_ts,
  COALESCE((SELECT prev_count FROM series), 0)::bigint AS prev_count,
  COALESCE((SELECT num_points FROM series), 0)::bigint AS num_points,
  COALESCE((
    SELECT data[first_index : last_index] FROM series, bounds
  ), ARRAY[]::bigint[]) AS data;
