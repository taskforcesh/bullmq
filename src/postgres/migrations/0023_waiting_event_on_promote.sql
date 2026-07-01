-- BullMQ PostgreSQL backend — waiting event on delayed promotion (schema v23).
--
-- When a due delayed job is promoted to waiting, emit a `waiting` event for it
-- (mirrors Redis, which publishes `waiting` as delayed jobs are moved into the
-- wait list). Otherwise identical to the v15 definition.
CREATE OR REPLACE FUNCTION bullmq_move_to_active(
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

  FOR v_id IN
    WITH promoted AS (
      UPDATE bullmq_job
         SET state = 'waiting', delay_ms = 0
       WHERE queue = p_queue
         AND state = 'delayed'
         AND process_at_ms <= p_now
      RETURNING id
    )
    SELECT id FROM promoted
  LOOP
    PERFORM bullmq_publish_event(p_queue, 'waiting',
      jsonb_build_object('jobId', v_id, 'prev', 'delayed'));
  END LOOP;

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
