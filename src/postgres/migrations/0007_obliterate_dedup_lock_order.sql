-- Match deduplicate_job's dedup -> job lock order in every obliteration batch.
CREATE OR REPLACE FUNCTION obliterate(
  p_queue text, p_count integer, p_force boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_deleted integer;
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

  -- Producers can still add while paused. Lock existing dedup rows before
  -- any job deletion, including non-final batches, to avoid waiting for a
  -- dedup row while its owner is waiting for a job this transaction deleted.
  -- Keep keys intact until final cleanup so intermediate batches do not
  -- prematurely end live deduplication windows.
  PERFORM dedup_id FROM dedup
   WHERE queue = p_queue
   ORDER BY dedup_id
   FOR UPDATE;

  WITH batch AS (
    SELECT id FROM job WHERE queue = p_queue LIMIT p_count
  )
  DELETE FROM job j
   USING batch
   WHERE j.queue = p_queue AND j.id = batch.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted >= p_count THEN
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
