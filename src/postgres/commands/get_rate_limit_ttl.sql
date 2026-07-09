-- Current rate-limit ttl in ms (Redis getRateLimitTtl semantics). Params:
-- $1 queue, $2 maxJobs (0 = unspecified → meta `max` / raw window), $3 now_ms.
SELECT bullmq_rate_limit_ttl($1, $2, $3) AS ttl;
