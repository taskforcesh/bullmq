-- BullMQ PostgreSQL backend — reprocess + worker name (schema version 13).
--
--   * reprocess_job re-queues a failed/completed job back to wait (Job.retry),
--     optionally resetting the attempt counters.
--   * move_to_active now records the processing worker's name (processedBy).

-- reprocess_job: move a finished job (failed/completed) back to wait.
-- Returns 1 ok, -1 missing, -3 not in the expected state.
CREATE FUNCTION bullmq_reprocess_job(
  p_queue         text,
  p_id            text,
  p_state         text,
  p_lifo          boolean,
  p_reset_made    boolean,
  p_reset_started boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state bullmq_job_state;
  v_seq   bigint;
BEGIN
  SELECT state INTO v_state
    FROM bullmq_job WHERE queue = p_queue AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN -1;
  END IF;
  IF v_state <> p_state::bullmq_job_state THEN
    RETURN -3;
  END IF;

  v_seq := nextval('bullmq_job_seq');
  IF p_lifo THEN
    v_seq := -v_seq;
  END IF;

  UPDATE bullmq_job
     SET state = 'waiting',
         seq = v_seq,
         process_at_ms = NULL,
         finished_at_ms = NULL,
         return_value = NULL,
         failed_reason = NULL,
         stacktrace = NULL,
         attempts_made = CASE WHEN p_reset_made THEN 0 ELSE attempts_made END,
         attempts_started =
           CASE WHEN p_reset_started THEN 0 ELSE attempts_started END
   WHERE queue = p_queue AND id = p_id;

  PERFORM pg_notify('bullmq_jobs', p_queue);
  PERFORM bullmq_publish_event(p_queue, 'waiting',
    jsonb_build_object('jobId', p_id, 'prev', p_state));
  RETURN 1;
END;
$$;

-- Recreate move_to_active with a worker-name parameter (processedBy).
DROP FUNCTION IF EXISTS bullmq_move_to_active(text, text, bigint, bigint);
CREATE FUNCTION bullmq_move_to_active(
  p_queue   text,
  p_token   text,
  p_lock_ms bigint,
  p_now     bigint,
  p_name    text
) RETURNS SETOF bullmq_job
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id  text;
  v_job bullmq_job;
BEGIN
  IF EXISTS (
    SELECT 1 FROM bullmq_meta
     WHERE queue = p_queue AND field = 'paused' AND value = '1'
  ) THEN
    RETURN;
  END IF;

  UPDATE bullmq_job
     SET state = 'waiting'
   WHERE queue = p_queue
     AND state = 'delayed'
     AND process_at_ms <= p_now;

  SELECT id INTO v_id
    FROM bullmq_job
   WHERE queue = p_queue AND state = 'waiting'
   ORDER BY priority, seq
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE bullmq_job
     SET state = 'active',
         lock_token = p_token,
         locked_until_ms = p_now + p_lock_ms,
         processed_at_ms = p_now,
         processed_by = p_name,
         attempts_started = attempts_started + 1
   WHERE queue = p_queue AND id = v_id
  RETURNING * INTO v_job;

  PERFORM bullmq_publish_event(p_queue, 'active',
    jsonb_build_object('jobId', v_id, 'prev', 'waiting'));

  RETURN NEXT v_job;
END;
$$;
