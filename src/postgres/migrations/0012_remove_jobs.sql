-- BullMQ PostgreSQL backend — bulk job removal.
--
-- Adds `remove_jobs`, the backing function of `Queue.removeJobs`. It removes
-- several jobs by id in a single call (and therefore a single transaction),
-- mirroring the Redis `removeJobs` script: jobs that do not exist, that are
-- locked by a worker (or have a locked pending descendant when removing
-- children) and scheduler jobs are skipped instead of aborting the batch.
--
-- Purely additive (a new function), so older clients keep working.

CREATE FUNCTION remove_jobs(
  p_queue text, p_ids text[], p_remove_children boolean
) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id text;
BEGIN
  FOREACH v_id IN ARRAY p_ids LOOP
    BEGIN
      IF remove(p_queue, v_id, p_remove_children) > 0 THEN
        RETURN NEXT v_id;
      END IF;
    EXCEPTION WHEN SQLSTATE 'BM001' THEN
      -- Scheduler job: skipped, the rest of the batch still goes through.
      NULL;
    END;
  END LOOP;
END;
$$;
