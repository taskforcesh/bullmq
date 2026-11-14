CREATE OR REPLACE FUNCTION add_job_scheduler(
  p_queue         text,
  p_scheduler_id  text,
  p_next_millis   bigint,
  p_template_data jsonb,
  p_template_opts jsonb,
  p_opts          jsonb,
  p_delayed_opts  jsonb,
  p_now           bigint,
  p_producer_id   text
) RETURNS TABLE (job_id text, delay bigint)
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_name    text    := p_opts ->> 'name';
  v_tz      text    := p_opts ->> 'tz';
  v_pattern text    := p_opts ->> 'pattern';
  v_every   bigint  := (p_opts ->> 'every')::bigint;
  v_offset  bigint  := COALESCE((p_opts ->> 'offset')::bigint,
                                (p_delayed_opts #>> '{repeat,offset}')::bigint, 0);
  v_offset_provided boolean := (p_opts ->> 'offset') IS NOT NULL
                            OR (p_delayed_opts #>> '{repeat,offset}') IS NOT NULL;
  v_start   bigint  := (p_opts ->> 'startDate')::bigint;
  v_end     bigint  := (p_opts ->> 'endDate')::bigint;
  v_limit   integer := (p_opts ->> 'limit')::integer;
  v_count   integer := (p_opts ->> 'count')::integer;
  v_prev    bigint;
  v_millis  bigint;
  v_prev_every bigint;
  v_existing_offset bigint;
  v_ic      integer;
  v_next    bigint  := p_next_millis;
  v_updated_every boolean := false;
  v_removed boolean := false;
  v_collision boolean := false;
  v_new_offset bigint := v_offset;
  v_em      bigint[];
  v_jobid   text;
  v_delay   bigint;
  v_state   job_state;
  v_seq     bigint;
BEGIN
  SELECT next_run_ms, every_ms, iteration_count, offset_ms
    INTO v_prev, v_prev_every, v_ic, v_existing_offset
    FROM scheduler WHERE queue = p_queue AND scheduler_id = p_scheduler_id;

  -- `v_prev` is the previous iteration (used for removal); `v_millis` seeds the
  -- `every` formula and is reset to NULL when the interval itself changed.
  v_millis := v_prev;
  IF v_every IS NOT NULL THEN
    IF v_prev IS NOT NULL AND v_prev_every IS DISTINCT FROM v_every THEN
      v_millis := NULL;
      v_updated_every := true;
    END IF;
    v_em := scheduler_every_next_millis(v_millis, v_every, p_now, v_offset, v_start);
    v_next := v_em[1];
    v_new_offset := v_em[2];
    -- Preserve the offset established at scheduler creation. On re-upsert of an
    -- existing scheduler without an explicit offset, keep the stored offset
    -- instead of recomputing it against the (possibly changed) `every`. Mirrors
    -- Redis storeJobScheduler, which writes a freshly-computed offset only on
    -- first creation and otherwise preserves the existing hash field.
    IF NOT v_offset_provided AND v_existing_offset IS NOT NULL THEN
      v_new_offset := v_existing_offset;
    END IF;
  END IF;

  -- Remove the previous iteration's (still-pending) job, if any.
  IF v_prev IS NOT NULL THEN
    DELETE FROM job
     WHERE queue = p_queue
       AND id = 'repeat:' || p_scheduler_id || ':' || v_prev
       AND state IN ('delayed', 'waiting');
    IF FOUND THEN
      v_removed := true;
    END IF;
  END IF;

  IF v_removed AND v_every IS NOT NULL AND NOT v_updated_every THEN
    v_next := v_prev;
  END IF;

  -- Collision: a job with the next id already exists in a non-replaceable state
  -- (e.g. it is active). For `every` we try the following slot; for `pattern`
  -- we fail — unless we just removed the previous job (override replaces it).
  v_jobid := 'repeat:' || p_scheduler_id || ':' || v_next;
  IF EXISTS (SELECT 1 FROM job WHERE queue = p_queue AND id = v_jobid) THEN
    IF v_every IS NOT NULL THEN
      v_next := v_next + v_every;
      v_jobid := 'repeat:' || p_scheduler_id || ':' || v_next;
      IF EXISTS (SELECT 1 FROM job WHERE queue = p_queue AND id = v_jobid) THEN
        RAISE EXCEPTION 'scheduler job slots busy'
          USING ERRCODE = 'BM001', DETAIL = '-11';
      END IF;
    ELSIF NOT v_removed THEN
      RAISE EXCEPTION 'scheduler job id collision'
        USING ERRCODE = 'BM001', DETAIL = '-10';
    ELSE
      v_collision := true;
    END IF;
  END IF;

  v_delay := GREATEST(v_next - p_now, 0);

  -- Upsert the scheduler row (iteration count preserved; seeded from count + 1, or 1, the first time).
  INSERT INTO scheduler (
    queue, scheduler_id, name, next_run_ms, pattern, every_ms, tz,
    start_date_ms, end_date_ms, limit_count, iteration_count, offset_ms,
    template_data, template_opts, producer_id
  ) VALUES (
    p_queue, p_scheduler_id, v_name, v_next, v_pattern, v_every, v_tz,
    v_start, v_end, v_limit, COALESCE(v_ic, v_count + 1, 1), v_new_offset,
    p_template_data, p_template_opts, p_producer_id
  )
  ON CONFLICT (queue, scheduler_id) DO UPDATE SET
    name = EXCLUDED.name,
    next_run_ms = EXCLUDED.next_run_ms,
    pattern = EXCLUDED.pattern,
    every_ms = EXCLUDED.every_ms,
    tz = EXCLUDED.tz,
    start_date_ms = EXCLUDED.start_date_ms,
    end_date_ms = EXCLUDED.end_date_ms,
    limit_count = EXCLUDED.limit_count,
    offset_ms = EXCLUDED.offset_ms,
    template_data = EXCLUDED.template_data,
    template_opts = EXCLUDED.template_opts,
    producer_id = EXCLUDED.producer_id;

  -- Create the next delayed (or immediately-ready) job. When `v_collision` we
  -- are replacing an existing (removed-prev) row, so fully reset it.
  v_seq := nextval('job_seq');
  IF v_delay > 0 THEN
    v_state := 'delayed';
  ELSE
    v_state := 'waiting';
  END IF;

  INSERT INTO job (
    queue, id, seq, name, state, data, opts, priority, delay_ms, max_attempts,
    added_at_ms, process_at_ms, scheduler_id
  ) VALUES (
    p_queue, v_jobid, v_seq, v_name, v_state,
    COALESCE(p_template_data, '{}'::jsonb),
    COALESCE(p_delayed_opts, '{}'::jsonb)
      || jsonb_build_object('delay', v_delay, 'jobId', v_jobid),
    COALESCE((p_delayed_opts ->> 'priority')::integer, 0), v_delay,
    COALESCE((p_delayed_opts ->> 'attempts')::integer, 1),
    COALESCE((p_delayed_opts ->> 'timestamp')::bigint, p_now),
    CASE WHEN v_delay > 0 THEN v_next ELSE NULL END, p_scheduler_id
  )
  ON CONFLICT (queue, id) DO UPDATE SET
    seq = EXCLUDED.seq,
    name = EXCLUDED.name,
    state = EXCLUDED.state,
    data = EXCLUDED.data,
    opts = EXCLUDED.opts,
    priority = EXCLUDED.priority,
    delay_ms = EXCLUDED.delay_ms,
    max_attempts = EXCLUDED.max_attempts,
    attempts_made = 0,
    attempts_started = 0,
    added_at_ms = EXCLUDED.added_at_ms,
    process_at_ms = EXCLUDED.process_at_ms,
    processed_at_ms = NULL,
    finished_at_ms = NULL,
    return_value = NULL,
    failed_reason = NULL,
    stacktrace = NULL,
    lock_token = NULL,
    locked_until_ms = NULL,
    stalled_count = 0,
    processed_by = NULL,
    scheduler_id = EXCLUDED.scheduler_id;

  PERFORM pg_notify('bullmq_jobs', p_queue);

  job_id := v_jobid;
  delay := v_delay;
  RETURN NEXT;
END;
$$;
