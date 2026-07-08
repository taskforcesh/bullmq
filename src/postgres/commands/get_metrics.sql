-- Metrics for a queue/kind: the cumulative meta `count` and the per-minute data
-- points (newest first), sliced to [start, end] with Redis LRANGE semantics
-- (index 0 is the newest point; a negative end means "to the oldest").
-- Params: $1 queue, $2 kind ('completed' | 'failed'), $3 start, $4 end.
SELECT
  COALESCE((SELECT count FROM bullmq_metrics
             WHERE queue = $1 AND kind = $2), 0)::bigint AS total,
  COALESCE((
    SELECT CASE
             WHEN $4 < 0 THEN data[($3 + 1) : ]
             ELSE data[($3 + 1) : ($4 + 1)]
           END
      FROM bullmq_metrics WHERE queue = $1 AND kind = $2
  ), ARRAY[]::bigint[]) AS data;
