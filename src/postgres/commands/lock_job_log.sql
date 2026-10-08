-- Serializes concurrent addLog calls for one job. Params: $1 lock key, $2 queue, $3 job_id.
-- Must run right before add_log.sql in the same transaction - the lock only holds for that scope.
SELECT pg_advisory_xact_lock($1, hashtext($2 || ':' || $3));
