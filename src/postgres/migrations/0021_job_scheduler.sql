-- BullMQ PostgreSQL backend — job schedulers / repeatable jobs (schema v21).
--
-- A scheduler is a job factory: it stores a template (data/opts) plus a repeat
-- spec (cron `pattern` or fixed `every` ms) and, on each upsert, produces the
-- next delayed job `repeat:<schedulerId>:<nextMillis>`. For cron the caller
-- computes nextMillis (JS cron-parser); for `every` the backend computes it.

ALTER TABLE bullmq_scheduler ADD COLUMN IF NOT EXISTS offset_ms bigint;

-- Mirror of the Lua getJobSchedulerEveryNextMillis: returns the next due time
-- for a fixed-interval scheduler and the aligned offset, as a 2-int array.
CREATE FUNCTION bullmq_scheduler_every_next_millis(
  p_prev bigint, p_every bigint, p_now bigint, p_offset bigint, p_start bigint
) RETURNS bigint[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_next   bigint;
  v_offset bigint := p_offset;
BEGIN
  IF p_prev IS NULL THEN
    IF p_start IS NOT NULL THEN
      v_next := GREATEST(p_start, p_now);
    ELSE
      v_next := p_now;
      IF p_offset IS NOT NULL AND p_offset > 0 THEN
        v_next := (p_now / p_every) * p_every + p_offset;
        IF v_next <= p_now THEN
          v_next := v_next + p_every;
        END IF;
      END IF;
    END IF;
  ELSE
    v_next := p_prev + p_every;
    IF v_next < p_now THEN
      v_next := (p_now / p_every) * p_every + p_every + COALESCE(p_offset, 0);
    END IF;
  END IF;

  IF v_offset IS NULL OR v_offset = 0 THEN
    v_offset := v_next - (v_next / p_every) * p_every;
  END IF;

  RETURN ARRAY[v_next, v_offset];
END;
$$;

-- Registers/updates a scheduler and enqueues its next delayed job.
-- Returns (job_id, delay).
CREATE FUNCTION bullmq_add_job_scheduler(
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
  v_start   bigint  := (p_opts ->> 'startDate')::bigint;
  v_end     bigint  := (p_opts ->> 'endDate')::bigint;
  v_limit   integer := (p_opts ->> 'limit')::integer;
  v_prev    bigint;
  v_millis  bigint;
  v_prev_every bigint;
  v_ic      integer;
  v_next    bigint  := p_next_millis;
  v_updated_every boolean := false;
  v_removed boolean := false;
  v_collision boolean := false;
  v_new_offset bigint := v_offset;
  v_em      bigint[];
  v_jobid   text;
  v_delay   bigint;
  v_state   bullmq_job_state;
  v_seq     bigint;
BEGIN
  SELECT next_run_ms, every_ms, iteration_count
    INTO v_prev, v_prev_every, v_ic
    FROM bullmq_scheduler WHERE queue = p_queue AND scheduler_id = p_scheduler_id;

  -- `v_prev` is the previous iteration (used for removal); `v_millis` seeds the
  -- `every` formula and is reset to NULL when the interval itself changed.
  v_millis := v_prev;
  IF v_every IS NOT NULL THEN
    IF v_prev IS NOT NULL AND v_prev_every IS DISTINCT FROM v_every THEN
      v_millis := NULL;
      v_updated_every := true;
    END IF;
    v_em := bullmq_scheduler_every_next_millis(v_millis, v_every, p_now, v_offset, v_start);
    v_next := v_em[1];
    v_new_offset := v_em[2];
  END IF;

  -- Remove the previous iteration's (still-pending) job, if any.
  IF v_prev IS NOT NULL THEN
    DELETE FROM bullmq_job
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
  IF EXISTS (SELECT 1 FROM bullmq_job WHERE queue = p_queue AND id = v_jobid) THEN
    IF v_every IS NOT NULL THEN
      v_next := v_next + v_every;
      v_jobid := 'repeat:' || p_scheduler_id || ':' || v_next;
      IF EXISTS (SELECT 1 FROM bullmq_job WHERE queue = p_queue AND id = v_jobid) THEN
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

  -- Upsert the scheduler row (iteration count preserved, or 1 the first time).
  INSERT INTO bullmq_scheduler (
    queue, scheduler_id, name, next_run_ms, pattern, every_ms, tz,
    start_date_ms, end_date_ms, limit_count, iteration_count, offset_ms,
    template_data, template_opts, producer_id
  ) VALUES (
    p_queue, p_scheduler_id, v_name, v_next, v_pattern, v_every, v_tz,
    v_start, v_end, v_limit, COALESCE(v_ic, 1), v_new_offset,
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
  v_seq := nextval('bullmq_job_seq');
  IF v_delay > 0 THEN
    v_state := 'delayed';
  ELSE
    v_state := 'waiting';
  END IF;

  INSERT INTO bullmq_job (
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

-- Advance an existing scheduler to its next iteration (no template change).
-- Returns the new job id, or NULL if the scheduler no longer exists.
CREATE FUNCTION bullmq_update_job_scheduler_next_millis(
  p_queue         text,
  p_scheduler_id  text,
  p_next_millis   bigint,
  p_template_data jsonb,
  p_delayed_opts  jsonb,
  p_now           bigint,
  p_producer_id   text
) RETURNS text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_name   text;
  v_prev   bigint;
  v_every  bigint;
  v_start  bigint;
  v_offset bigint;
  v_data   jsonb;
  v_next   bigint := p_next_millis;
  v_new_offset bigint;
  v_em     bigint[];
  v_jobid  text;
  v_current text;
  v_delay  bigint;
  v_state  bullmq_job_state;
  v_seq    bigint;
BEGIN
  SELECT name, next_run_ms, every_ms, start_date_ms, offset_ms, template_data
    INTO v_name, v_prev, v_every, v_start, v_offset, v_data
    FROM bullmq_scheduler WHERE queue = p_queue AND scheduler_id = p_scheduler_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_every IS NULL THEN
    v_every := (p_delayed_opts #>> '{repeat,every}')::bigint;
  END IF;

  IF v_every IS NOT NULL THEN
    v_offset := COALESCE(v_offset, (p_delayed_opts #>> '{repeat,offset}')::bigint, 0);
    v_em := bullmq_scheduler_every_next_millis(v_prev, v_every, p_now, v_offset, v_start);
    v_next := v_em[1];
    v_new_offset := v_em[2];
  END IF;

  -- Only the producer of the current iteration may advance the scheduler;
  -- this guards against duplicate iterations from stale/concurrent finishes.
  v_current := 'repeat:' || p_scheduler_id || ':' || v_prev;
  IF p_producer_id IS DISTINCT FROM v_current THEN
    RETURN NULL;
  END IF;

  v_jobid := 'repeat:' || p_scheduler_id || ':' || v_next;

  -- If the next iteration's job already exists, this is a duplicate.
  IF EXISTS (SELECT 1 FROM bullmq_job WHERE queue = p_queue AND id = v_jobid) THEN
    PERFORM bullmq_publish_event(p_queue, 'duplicated',
      jsonb_build_object('jobId', v_jobid));
    RETURN NULL;
  END IF;

  v_delay := GREATEST(v_next - p_now, 0);

  UPDATE bullmq_scheduler
     SET next_run_ms = v_next,
         iteration_count = iteration_count + 1,
         offset_ms = COALESCE(offset_ms, v_new_offset),
         template_data = CASE
           WHEN p_template_data IS NOT NULL AND p_template_data <> '{}'::jsonb
             THEN p_template_data
           ELSE template_data
         END
   WHERE queue = p_queue AND scheduler_id = p_scheduler_id;

  v_seq := nextval('bullmq_job_seq');
  v_state := CASE WHEN v_delay > 0 THEN 'delayed' ELSE 'waiting' END;

  INSERT INTO bullmq_job (
    queue, id, seq, name, state, data, opts, priority, delay_ms, max_attempts,
    added_at_ms, process_at_ms, scheduler_id
  ) VALUES (
    p_queue, v_jobid, v_seq, v_name, v_state,
    COALESCE(NULLIF(v_data, '{}'::jsonb), p_template_data, '{}'::jsonb),
    COALESCE(p_delayed_opts, '{}'::jsonb)
      || jsonb_build_object('delay', v_delay, 'jobId', v_jobid),
    COALESCE((p_delayed_opts ->> 'priority')::integer, 0), v_delay,
    COALESCE((p_delayed_opts ->> 'attempts')::integer, 1),
    COALESCE((p_delayed_opts ->> 'timestamp')::bigint, p_now),
    CASE WHEN v_delay > 0 THEN v_next ELSE NULL END, p_scheduler_id
  )
  ON CONFLICT (queue, id) DO NOTHING;

  PERFORM pg_notify('bullmq_jobs', p_queue);

  RETURN v_jobid;
END;
$$;
