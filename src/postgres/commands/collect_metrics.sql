-- Record one finished job into the queue/kind metrics (per-minute deltas).
-- Params: $1 queue, $2 kind ('completed' | 'failed'), $3 maxDataPoints,
-- $4 finish timestamp (epoch ms).
SELECT bullmq_collect_metrics($1, $2, $3, $4);
