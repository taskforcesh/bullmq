-- BullMQ PostgreSQL backend — parent linkage on addJob (schema version 12).
--
-- A single job created with a `parent` option must, like a flow child, verify
-- the parent exists (else ParentJobNotExist / -5) and register itself as a
-- pending dependency of that parent.

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

  -- Verify the parent exists before inserting (atomic: a failure rolls back).
  IF p_parent_id IS NOT NULL AND p_parent_queue IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM bullmq_job WHERE queue = p_parent_queue AND id = p_parent_id
    ) THEN
      RAISE EXCEPTION 'bullmq: missing parent %', p_parent_key
        USING ERRCODE = 'BM001', DETAIL = '-5';
    END IF;
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

  -- Register the new job as a pending dependency of its parent.
  IF v_inserted AND p_parent_id IS NOT NULL AND p_parent_queue IS NOT NULL THEN
    INSERT INTO bullmq_job_dependency (
      parent_queue, parent_id, child_queue, child_id, child_key, status
    ) VALUES (
      p_parent_queue, p_parent_id, p_queue, v_id,
      p_queue || ':' || v_id, 'pending'
    )
    ON CONFLICT (parent_queue, parent_id, child_key) DO NOTHING;

    UPDATE bullmq_job
       SET pending_deps = pending_deps + 1
     WHERE queue = p_parent_queue AND id = p_parent_id;
  END IF;

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
