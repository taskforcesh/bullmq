-- Claim the next ready job for a worker (0 or 1 rows), honouring the limiter.
-- Params: $1 queue, $2 token, $3 lock_ms, $4 now_ms, $5 worker name,
-- $6 limiter max (worker option, NULL if none), $7 limiter duration ms.
SELECT * FROM bullmq_move_to_active($1, $2, $3, $4, $5, $6, $7);
