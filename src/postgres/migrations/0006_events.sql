-- BullMQ PostgreSQL backend — event stream (schema version 6).
--
-- QueueEvents consumes an append-only event stream. In Redis this is an XADD
-- stream read with a blocking XREAD; here events live in `bullmq_event` (a
-- globally-ordered id per insert) and blocking reads use LISTEN/NOTIFY on the
-- shared `bullmq_events` channel. This migration adds the publish helper and
-- weaves event emission into the lifecycle operations.

-- ──────────────────────────────────────────────────────────────────────────
-- publish_event: append an event to the stream, notify consumers, and trim the
-- stream to the queue's configured max length (`opts.maxLenEvents`, default
-- 10000). Returns the new event id.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_publish_event(
  p_queue text,
  p_event text,
  p_data  jsonb
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id      bigint;
  v_max     integer;
  v_cutoff  bigint;
BEGIN
  INSERT INTO bullmq_event (queue, event, data, created_at_ms)
  VALUES (
    p_queue, p_event, COALESCE(p_data, '{}'::jsonb),
    (extract(epoch FROM clock_timestamp()) * 1000)::bigint
  )
  RETURNING id INTO v_id;

  PERFORM pg_notify('bullmq_events', p_queue);

  SELECT value::integer INTO v_max
    FROM bullmq_meta
   WHERE queue = p_queue AND field = 'opts.maxLenEvents';
  IF v_max IS NULL THEN
    v_max := 10000;
  END IF;

  IF v_max > 0 THEN
    SELECT id INTO v_cutoff
      FROM bullmq_event
     WHERE queue = p_queue
     ORDER BY id DESC
     OFFSET v_max
     LIMIT 1;
    IF v_cutoff IS NOT NULL THEN
      DELETE FROM bullmq_event WHERE queue = p_queue AND id <= v_cutoff;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- Recreate add_job to emit a 'waiting' (or 'delayed') event.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bullmq_add_job(
  p_queue        text,
  p_id           text,
  p_name         text,
  p_data         jsonb,
  p_opts         jsonb,
  p_priority     integer,
  p_delay        bigint,
  p_timestamp    bigint,
  p_max_attempts integer,
  p_parent_queue text,
  p_parent_id    text,
  p_parent_key   text,
  p_dedup_id     text,
  p_scheduler_id text,
  p_lifo         boolean
) RETURNS text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id    text := p_id;
  v_seq   bigint;
  v_state bullmq_job_state;
  v_process_at bigint;
  v_inserted boolean;
BEGIN
  IF v_id IS NULL OR v_id = '' THEN
    INSERT INTO bullmq_meta (queue, field, value)
      VALUES (p_queue, 'id', '1')
      ON CONFLICT (queue, field)
      DO UPDATE SET value = (bullmq_meta.value::bigint + 1)::text
      RETURNING value INTO v_id;
  END IF;

  v_seq := nextval('bullmq_job_seq');
  IF p_lifo THEN
    v_seq := -v_seq;
  END IF;

  IF p_delay > 0 THEN
    v_state := 'delayed';
    v_process_at := p_timestamp + p_delay;
  ELSE
    v_state := 'waiting';
    v_process_at := NULL;
  END IF;

  INSERT INTO bullmq_job (
    queue, id, seq, name, state,
    data, opts, priority, delay_ms, max_attempts,
    added_at_ms, process_at_ms,
    dedup_id, scheduler_id,
    parent_queue, parent_id, parent_key
  ) VALUES (
    p_queue, v_id, v_seq, p_name, v_state,
    COALESCE(p_data, '{}'::jsonb), COALESCE(p_opts, '{}'::jsonb),
    COALESCE(p_priority, 0), COALESCE(p_delay, 0), COALESCE(p_max_attempts, 1),
    p_timestamp, v_process_at,
    p_dedup_id, p_scheduler_id,
    p_parent_queue, p_parent_id, p_parent_key
  )
  ON CONFLICT (queue, id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted THEN
    PERFORM pg_notify('bullmq_jobs', p_queue);
    IF v_state = 'delayed' THEN
      PERFORM bullmq_publish_event(p_queue, 'delayed',
        jsonb_build_object('jobId', v_id, 'delay', v_process_at));
    ELSE
      PERFORM bullmq_publish_event(p_queue, 'waiting',
        jsonb_build_object('jobId', v_id));
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- Recreate move_to_active to emit an 'active' event for the claimed job.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bullmq_move_to_active(
  p_queue   text,
  p_token   text,
  p_lock_ms bigint,
  p_now     bigint
) RETURNS SETOF bullmq_job
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id  text;
  v_job bullmq_job;
BEGIN
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
         attempts_started = attempts_started + 1
   WHERE queue = p_queue AND id = v_id
  RETURNING * INTO v_job;

  PERFORM bullmq_publish_event(p_queue, 'active',
    jsonb_build_object('jobId', v_id, 'prev', 'waiting'));

  RETURN NEXT v_job;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- Recreate move_to_completed to emit a 'completed' event.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bullmq_move_to_completed(
  p_queue        text,
  p_id           text,
  p_token        text,
  p_return_value jsonb,
  p_finished_on  bigint,
  p_remove_all   boolean,
  p_keep_age     bigint,
  p_keep_count   integer
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE bullmq_job
     SET state = 'completed',
         return_value = p_return_value,
         finished_at_ms = p_finished_on,
         lock_token = NULL,
         locked_until_ms = NULL,
         attempts_made = attempts_made + 1
   WHERE queue = p_queue
     AND id = p_id
     AND state = 'active'
     AND lock_token = p_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'bullmq: job % is not active or lock mismatch', p_id
      USING ERRCODE = 'BM001';
  END IF;

  PERFORM bullmq_publish_event(p_queue, 'completed',
    jsonb_build_object(
      'jobId', p_id,
      'returnvalue', COALESCE(p_return_value, 'null'::jsonb)::text,
      'prev', 'active'
    ));

  PERFORM bullmq_apply_retention(
    p_queue, p_id, 'completed', p_finished_on,
    p_remove_all, p_keep_age, p_keep_count
  );

  RETURN p_finished_on;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- Recreate move_to_failed to emit a 'failed' event.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bullmq_move_to_failed(
  p_queue         text,
  p_id            text,
  p_token         text,
  p_failed_reason text,
  p_stacktrace    jsonb,
  p_finished_on   bigint,
  p_remove_all    boolean,
  p_keep_age      bigint,
  p_keep_count    integer
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE bullmq_job
     SET state = 'failed',
         failed_reason = p_failed_reason,
         stacktrace = COALESCE(p_stacktrace, stacktrace),
         finished_at_ms = p_finished_on,
         lock_token = NULL,
         locked_until_ms = NULL,
         attempts_made = attempts_made + 1
   WHERE queue = p_queue
     AND id = p_id
     AND state = 'active'
     AND lock_token = p_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'bullmq: job % is not active or lock mismatch', p_id
      USING ERRCODE = 'BM001';
  END IF;

  PERFORM bullmq_publish_event(p_queue, 'failed',
    jsonb_build_object(
      'jobId', p_id,
      'failedReason', p_failed_reason,
      'prev', 'active'
    ));

  PERFORM bullmq_apply_retention(
    p_queue, p_id, 'failed', p_finished_on,
    p_remove_all, p_keep_age, p_keep_count
  );

  RETURN p_finished_on;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- update_progress: update progress and emit a 'progress' event.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_update_progress(
  p_queue    text,
  p_id       text,
  p_progress jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  UPDATE bullmq_job SET progress = p_progress WHERE queue = p_queue AND id = p_id;

  PERFORM bullmq_publish_event(p_queue, 'progress',
    jsonb_build_object('jobId', p_id, 'data', p_progress::text));
END;
$$;
