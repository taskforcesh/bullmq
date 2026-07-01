-- BullMQ PostgreSQL backend — obliterate (schema v27).
--
-- Completely destroys a queue and all of its contents, mirroring
-- obliterate-2.lua:
--   * The queue must be paused, else return -1.
--   * If there are active jobs and `force` is not set, return -2.
--   * Otherwise delete up to `p_count` jobs; return 1 while more remain (the
--     caller loops), and once every job is gone delete the remaining
--     per-queue data and return 0.
--
-- `bullmq_job_log` and `bullmq_job_dependency` rows cascade from `bullmq_job`,
-- so deleting the jobs removes their logs and (parent-side) dependency links.
CREATE FUNCTION bullmq_obliterate(
  p_queue text, p_count integer, p_force boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bullmq_meta
     WHERE queue = p_queue AND field = 'paused' AND value = '1'
  ) THEN
    RETURN -1;  -- NotPaused
  END IF;

  IF NOT p_force AND EXISTS (
    SELECT 1 FROM bullmq_job WHERE queue = p_queue AND state = 'active'
  ) THEN
    RETURN -2;  -- ExistActiveJobs
  END IF;

  WITH batch AS (
    SELECT id FROM bullmq_job WHERE queue = p_queue LIMIT p_count
  )
  DELETE FROM bullmq_job j
   USING batch
   WHERE j.queue = p_queue AND j.id = batch.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- More jobs than the batch budget: tell the caller to come back.
  IF v_deleted >= p_count THEN
    RETURN 1;
  END IF;

  -- Every job is gone; remove the rest of the queue's footprint.
  DELETE FROM bullmq_scheduler  WHERE queue = p_queue;
  DELETE FROM bullmq_rate_limit WHERE queue = p_queue;
  DELETE FROM bullmq_event      WHERE queue = p_queue;
  DELETE FROM bullmq_metrics    WHERE queue = p_queue;
  DELETE FROM bullmq_dedup      WHERE queue = p_queue;
  DELETE FROM bullmq_dedup_next WHERE queue = p_queue;
  DELETE FROM bullmq_meta       WHERE queue = p_queue;
  RETURN 0;
END;
$$;
