-- Serializes concurrent addLog calls for one job so the next INSERT into
-- job_log picks a fresh idx. Params: $1 lock key, $2 queue, $3 job_id.
-- Must run on the same connection, in the same transaction, as the
-- add_log.sql that follows it — the lock only holds for that scope.
SELECT pg_advisory_xact_lock($1, hashtext($2 || ':' || $3));
