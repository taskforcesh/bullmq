-- A job's finished state and result/reason (for waitUntilFinished / isFinished).
-- Params: $1 queue, $2 id.
SELECT state, return_value, failed_reason
  FROM job WHERE queue = $1 AND id = $2;
