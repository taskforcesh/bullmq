-- The worker "no job" signal: effective rate-limit ttl + next delayed-job time.
-- Params: $1 queue, $2 limiter max (worker option, NULL if none), $3 now_ms.
SELECT rate_limit_ttl, next_delay FROM bullmq_next_signal($1, $2, $3);
