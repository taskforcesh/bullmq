-- BullMQ PostgreSQL backend — retention age boundary fix (schema version 14).
--
-- Age-based retention keeps jobs finished *within* the last `keep_age` seconds:
-- a job exactly on the boundary (finished_at = now - age*1000) is removed, so
-- the comparison is `<=`, not `<` (matches Redis: keep jobs with score above
-- the cutoff). Otherwise an N-second window keeps N+1 jobs.
CREATE OR REPLACE FUNCTION bullmq_apply_retention(
  p_queue       text,
  p_id          text,
  p_state       bullmq_job_state,
  p_now         bigint,
  p_remove_all  boolean,
  p_keep_age    bigint,
  p_keep_count  integer
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF p_remove_all THEN
    DELETE FROM bullmq_job WHERE queue = p_queue AND id = p_id;
    RETURN;
  END IF;

  IF p_keep_age IS NOT NULL THEN
    DELETE FROM bullmq_job
     WHERE queue = p_queue
       AND state = p_state
       AND finished_at_ms <= p_now - p_keep_age * 1000;
  END IF;

  IF p_keep_count IS NOT NULL THEN
    DELETE FROM bullmq_job
     WHERE queue = p_queue
       AND state = p_state
       AND id NOT IN (
         SELECT id FROM bullmq_job
          WHERE queue = p_queue AND state = p_state
          ORDER BY finished_at_ms DESC, seq DESC
          LIMIT p_keep_count
       );
  END IF;
END;
$$;
