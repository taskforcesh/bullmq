-- Acquire every batch dedup advisory lock before touching winner job rows.
CREATE OR REPLACE FUNCTION add_flow(p_entries jsonb) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  e              jsonb;
  v_id           text;
  v_seq          bigint;
  v_state        job_state;
  v_process_at   bigint;
  v_queue        text;
  v_delay        bigint;
  v_timestamp    bigint;
  v_lifo         boolean;
  v_parent_queue text;
  v_parent_id    text;
  v_awc          boolean;
  v_dedup_id     text;
  v_dedup        jsonb;
  v_winner       text;
  v_inserted     boolean;
  v_code         integer;
  v_lock_key     integer;
  v_ev_queue     text[]  := '{}';
  v_ev_event     text[]  := '{}';
  v_ev_data      jsonb[] := '{}';
  v_notify_jobs  text[]  := '{}';
  v_max          integer;
  v_parents_q    text[]  := '{}';
  v_parents_id   text[]  := '{}';
  v_failed_parents_q  text[] := '{}';
  v_failed_parents_id text[] := '{}';
  v_pq           text;
  v_pid          text;
  v_remaining    integer;
  v_now          bigint;
BEGIN
  -- Finish-and-fetch holds its dedup advisory lock while promoting delayed
  -- jobs. Take all batch locks before any job/sequence mutation, ordered by
  -- the actual lock key so reversed batches and hash collisions agree.
  FOR v_lock_key IN
    SELECT DISTINCT hashtext(
      'bullmq:dedup:' || (value ->> 'queue') || ':' || (value ->> 'dedupId'))
      FROM jsonb_array_elements(p_entries)
     WHERE value ->> 'dedupId' IS NOT NULL AND value ->> 'dedupId' <> ''
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(v_lock_key);
  END LOOP;

  FOR e IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    v_queue        := e ->> 'queue';
    v_id           := COALESCE(e ->> 'id', '');
    v_delay        := COALESCE((e ->> 'delay')::bigint, 0);
    v_timestamp    := COALESCE((e ->> 'timestamp')::bigint, 0);
    v_lifo         := COALESCE((e ->> 'lifo')::boolean, false);
    v_parent_queue := e ->> 'parentQueue';
    v_parent_id    := e ->> 'parentId';
    v_awc          := COALESCE((e ->> 'addToWaitingChildren')::boolean, false);
    v_dedup_id     := e ->> 'dedupId';

    IF v_id IS NULL OR v_id = '' THEN
      v_id := next_job_id(v_queue);
    END IF;

    IF v_dedup_id IS NOT NULL AND v_dedup_id <> '' THEN
      v_dedup := COALESCE(e -> 'opts' -> 'deduplication',
                          e -> 'opts' -> 'debounce',
                          jsonb_build_object('id', v_dedup_id));
      v_winner := deduplicate_job(v_queue, v_dedup, v_id, v_timestamp,
        e ->> 'name', COALESCE((e ->> 'data')::jsonb, '{}'::jsonb),
        COALESCE(e -> 'opts', '{}'::jsonb));
      IF v_winner IS NOT NULL THEN
        RETURN NEXT v_winner;
        CONTINUE;
      END IF;
    END IF;

    IF v_parent_id IS NOT NULL AND v_parent_queue IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM job
          WHERE queue = v_parent_queue AND id = v_parent_id
       ) THEN
      RETURN NEXT '-5';
      CONTINUE;
    END IF;

    v_seq := nextval('job_seq');
    IF v_lifo THEN
      v_seq := -v_seq;
    END IF;

    IF v_awc THEN
      v_state := 'waiting-children';
      v_process_at := NULL;
    ELSIF v_delay > 0 THEN
      v_state := 'delayed';
      v_process_at := v_timestamp + v_delay;
    ELSE
      v_state := 'waiting';
      v_process_at := NULL;
    END IF;

    INSERT INTO job (
      queue, id, seq, name, state,
      data, opts, priority, delay_ms, max_attempts,
      added_at_ms, process_at_ms,
      dedup_id, scheduler_id,
      parent_queue, parent_id, parent_key, pending_deps
    ) VALUES (
      v_queue, v_id, v_seq, e ->> 'name', v_state,
      COALESCE((e ->> 'data')::jsonb, '{}'::jsonb),
      COALESCE(e -> 'opts', '{}'::jsonb),
      COALESCE((e ->> 'priority')::integer, 0), v_delay,
      COALESCE((e ->> 'attempts')::integer, 1),
      v_timestamp, v_process_at,
      e ->> 'dedupId', e ->> 'schedulerId',
      v_parent_queue, v_parent_id, e ->> 'parentKey', 0
    )
    ON CONFLICT (queue, id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_parent_id IS NOT NULL AND v_parent_queue IS NOT NULL THEN
      v_parents_q  := array_append(v_parents_q, v_parent_queue);
      v_parents_id := array_append(v_parents_id, v_parent_id);

      IF v_inserted THEN
        INSERT INTO job_dependency (
          parent_queue, parent_id, child_queue, child_id, child_key, status
        ) VALUES (
          v_parent_queue, v_parent_id, v_queue, v_id,
          v_queue || ':' || v_id, 'pending'
        )
        ON CONFLICT (parent_queue, parent_id, child_key) DO NOTHING;

        UPDATE job
           SET pending_deps = pending_deps + 1
         WHERE queue = v_parent_queue AND id = v_parent_id;
      ELSE
        v_code := handle_duplicated_job(v_queue, v_id,
          v_parent_queue, v_parent_id, e ->> 'parentKey', v_timestamp, true);
        IF v_code = -7 THEN
          v_failed_parents_q  := array_append(v_failed_parents_q, v_parent_queue);
          v_failed_parents_id := array_append(v_failed_parents_id, v_parent_id);
          RETURN NEXT '-7';
          CONTINUE;
        END IF;
      END IF;
    END IF;

    IF v_inserted THEN
      v_ev_queue := array_append(v_ev_queue, v_queue);
      v_ev_event := array_append(v_ev_event, 'added');
      v_ev_data  := array_append(v_ev_data,
        jsonb_build_object('jobId', v_id, 'name', e ->> 'name'));
      IF v_state = 'waiting' THEN
        v_ev_queue    := array_append(v_ev_queue, v_queue);
        v_ev_event    := array_append(v_ev_event, 'waiting');
        v_ev_data     := array_append(v_ev_data,
          jsonb_build_object('jobId', v_id));
        v_notify_jobs := array_append(v_notify_jobs, v_queue);
      ELSIF v_state = 'delayed' THEN
        v_ev_queue    := array_append(v_ev_queue, v_queue);
        v_ev_event    := array_append(v_ev_event, 'delayed');
        v_ev_data     := array_append(v_ev_data,
          jsonb_build_object('jobId', v_id, 'delay', v_process_at));
        v_notify_jobs := array_append(v_notify_jobs, v_queue);
      ELSIF v_state = 'waiting-children' THEN
        v_ev_queue := array_append(v_ev_queue, v_queue);
        v_ev_event := array_append(v_ev_event, 'waiting-children');
        v_ev_data  := array_append(v_ev_data,
          jsonb_build_object('jobId', v_id));
      END IF;
    END IF;

    RETURN NEXT v_id;
  END LOOP;

  IF array_length(v_ev_queue, 1) > 0 THEN
    INSERT INTO event (queue, event, data, created_at_ms)
    SELECT q, ev, dat, (extract(epoch FROM clock_timestamp()) * 1000)::bigint
      FROM unnest(v_ev_queue, v_ev_event, v_ev_data)
             WITH ORDINALITY AS t(q, ev, dat, ord)
     ORDER BY ord;

    FOR v_queue IN SELECT DISTINCT q FROM unnest(v_ev_queue) AS q LOOP
      PERFORM pg_notify('bullmq_events', v_queue);

      SELECT value::integer INTO v_max
        FROM meta
       WHERE queue = v_queue AND field = 'opts.maxLenEvents';
      IF v_max IS NULL THEN
        v_max := 10000;
      END IF;
      IF v_max > 0
         AND pg_try_advisory_xact_lock(hashtext('bullmq:evtrim:' || v_queue))
      THEN
        DELETE FROM event
         WHERE queue = v_queue
           AND id <= (SELECT max(id) FROM event WHERE queue = v_queue)
                     - v_max;
      END IF;
    END LOOP;

    FOR v_queue IN SELECT DISTINCT q FROM unnest(v_notify_jobs) AS q LOOP
      PERFORM pg_notify('bullmq_jobs', v_queue);
    END LOOP;
  END IF;

  IF array_length(v_parents_q, 1) > 0 THEN
    v_now := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
    FOR v_pq, v_pid IN
      SELECT DISTINCT pq, pid
        FROM unnest(v_parents_q, v_parents_id) AS t(pq, pid)
       WHERE NOT EXISTS (
         SELECT 1
           FROM unnest(v_failed_parents_q, v_failed_parents_id) AS f(pq, pid)
          WHERE f.pq = t.pq AND f.pid = t.pid
       )
    LOOP
      SELECT pending_deps INTO v_remaining
        FROM job WHERE queue = v_pq AND id = v_pid;
      IF COALESCE(v_remaining, 0) = 0 THEN
        PERFORM move_parent_to_wait(v_pq, v_pid, v_now);
      END IF;
    END LOOP;
  END IF;
END;
$$;
