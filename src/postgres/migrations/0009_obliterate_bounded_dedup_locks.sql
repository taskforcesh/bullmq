-- Look up every key pointing at a selected winner without scanning the queue.
CREATE INDEX dedup_job_idx ON dedup (queue, job_id);

CREATE OR REPLACE FUNCTION obliterate(
  p_queue text, p_count integer, p_force boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_ids text[];
  v_final boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM meta
     WHERE queue = p_queue AND field = 'paused' AND value = '1'
  ) THEN
    RETURN -1;
  END IF;

  IF NOT p_force AND EXISTS (
    SELECT 1 FROM job WHERE queue = p_queue AND state = 'active'
  ) THEN
    RETURN -2;
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::text[]) INTO v_ids
    FROM (
      SELECT id FROM job WHERE queue = p_queue ORDER BY id LIMIT p_count
    ) AS batch;
  v_final := cardinality(v_ids) < p_count;

  -- Decide final cleanup before taking job locks. A full selected batch
  -- always asks for another batch, even if concurrent deletion removes some
  -- selected jobs, so whole-queue cleanup never introduces job -> dedup locks.
  IF v_final THEN
    PERFORM dedup_id FROM dedup
     WHERE queue = p_queue
     ORDER BY dedup_id
     FOR UPDATE;
  ELSE
    PERFORM dedup_id FROM dedup
     WHERE queue = p_queue AND job_id = ANY(v_ids)
     ORDER BY dedup_id
     FOR UPDATE;
  END IF;

  -- The only job-delete cascades are job_log and the parent's job_dependency
  -- rows. They do not delete child jobs or their dedup keys.
  DELETE FROM job WHERE queue = p_queue AND id = ANY(v_ids);

  IF NOT v_final THEN
    RETURN 1;
  END IF;

  DELETE FROM scheduler  WHERE queue = p_queue;
  DELETE FROM rate_limit WHERE queue = p_queue;
  DELETE FROM event      WHERE queue = p_queue;
  DELETE FROM metrics    WHERE queue = p_queue;
  DELETE FROM dedup      WHERE queue = p_queue;
  DELETE FROM dedup_next WHERE queue = p_queue;
  DELETE FROM meta       WHERE queue = p_queue;
  EXECUTE format(
    'DROP SEQUENCE IF EXISTS %I', job_id_seq_name(p_queue));
  RETURN 0;
END;
$$;
