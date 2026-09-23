-- Force the limiter window (dynamic / manual rate limit).
-- Params: $1 queue, $2 expire ms, $3 now_ms.
SELECT set_rate_limit($1, $2, $3);
