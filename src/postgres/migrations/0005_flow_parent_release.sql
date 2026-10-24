-- BullMQ PostgreSQL backend — deferred flow parent release (schema version 5).
--
-- When a flow references a child job id that already exists and is already
-- completed, `handle_duplicated_job` recorded the processed dependency and
-- immediately released the parent if it had no pending dependencies left.
-- Inside `add_flow` that check runs while the rest of the tree has not been
-- inserted yet, so a parent could be released (and picked up by a worker)
-- while later siblings were still being attached to it.
--
-- `handle_duplicated_job` gains a `p_defer_release` flag: when set it only
-- records the processed dependency. `add_flow` sets it and, once the whole
-- tree has been inserted, validates every parent touched by the flow and
-- releases the ones that genuinely have no pending dependencies left.

-- ──────────────────────────────────────────────────────────────────────────
-- handle_duplicated_job: re-attach an already-existing job to a new parent.
-- ──────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS handle_duplicated_job(
  text, text, text, text, text, bigint);

CREATE FUNCTION handle_duplicated_job(
  p_queue         text,
  p_id            text,
  p_parent_queue  text,
  p_parent_id     text,
  p_parent_key    text,
  p_now           bigint,
  p_defer_release boolean DEFAULT false
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_ex_pq     text;
  v_ex_pid    text;
  v_state     job_state;
  v_rv        jsonb;
  v_remaining integer;
  v_added     boolean;
BEGIN
  -- No new parent to attach: still a duplicate add, so announce it.
  IF p_parent_id IS NULL OR p_parent_queue IS NULL THEN
    PERFORM publish_event(p_queue, 'duplicated',
      jsonb_build_object('jobId', p_id));
    RETURN 0;
  END IF;

  SELECT parent_queue, parent_id, state, return_value
    INTO v_ex_pq, v_ex_pid, v_state, v_rv
    FROM job WHERE queue = p_queue AND id = p_id;

  -- The existing job already belongs to a different (still-existing) parent.
  IF v_ex_pq IS NOT NULL
     AND (v_ex_pq IS DISTINCT FROM p_parent_queue
          OR v_ex_pid IS DISTINCT FROM p_parent_id)
     AND EXISTS (
       SELECT 1 FROM job WHERE queue = v_ex_pq AND id = v_ex_pid
     ) THEN
    RETURN -7;
  END IF;

  IF v_state = 'completed' THEN
    -- Already finished: record a processed dependency (no pending increment)
    -- and release the parent if this was its last outstanding dependency.
    INSERT INTO job_dependency (
      parent_queue, parent_id, child_queue, child_id, child_key, status, value
    ) VALUES (
      p_parent_queue, p_parent_id, p_queue, p_id,
      p_queue || ':' || p_id, 'processed', v_rv
    )
    ON CONFLICT (parent_queue, parent_id, child_key)
      DO UPDATE SET status = 'processed', value = v_rv;

    -- Within a flow insert the parent may still be waiting for siblings that
    -- have not been inserted yet, so the release is validated by the caller
    -- once the whole tree is in.
    IF NOT p_defer_release THEN
      SELECT pending_deps INTO v_remaining
        FROM job WHERE queue = p_parent_queue AND id = p_parent_id;
      IF COALESCE(v_remaining, 0) = 0 THEN
        PERFORM move_parent_to_wait(p_parent_queue, p_parent_id, p_now);
      END IF;
    END IF;
  ELSE
    -- Still pending: register a pending dependency and count it on the parent.
    INSERT INTO job_dependency (
      parent_queue, parent_id, child_queue, child_id, child_key, status
    ) VALUES (
      p_parent_queue, p_parent_id, p_queue, p_id,
      p_queue || ':' || p_id, 'pending'
    )
    ON CONFLICT (parent_queue, parent_id, child_key) DO NOTHING;
    GET DIAGNOSTICS v_added = ROW_COUNT;
    IF v_added THEN
      UPDATE job SET pending_deps = pending_deps + 1
       WHERE queue = p_parent_queue AND id = p_parent_id;
    END IF;
  END IF;

  -- Point the existing job at its new parent.
  UPDATE job
     SET parent_queue = p_parent_queue,
         parent_id    = p_parent_id,
         parent_key   = p_parent_key
   WHERE queue = p_queue AND id = p_id;

  PERFORM publish_event(p_queue, 'duplicated',
    jsonb_build_object('jobId', p_id));

  RETURN 0;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- add_flow: insert a whole tree atomically, releasing parents only at the end.
-- ──────────────────────────────────────────────────────────────────────────
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
  -- Lifecycle-event accumulation. Rather than PERFORM publish_event per
  -- job (which turns a 1000-job addBulk into ~2000 extra statement executions —
  -- the dominant cost of a single-connection bulk add), events are collected
  -- here and flushed in ONE set-based INSERT after the loop. Appending to a
  -- plpgsql-local array is amortized O(1) (read-write "expanded array"), so this
  -- stays O(n).
  v_ev_queue     text[]  := '{}';
  v_ev_event     text[]  := '{}';
  v_ev_data      jsonb[] := '{}';
  v_notify_jobs  text[]  := '{}';
  v_max          integer;
  -- Parents touched by this flow; validated once the whole tree is inserted.
  v_parents_q    text[]  := '{}';
  v_parents_id   text[]  := '{}';
  v_failed_parents_q  text[] := '{}';
  v_failed_parents_id text[] := '{}';
  v_pq           text;
  v_pid          text;
  v_remaining    integer;
  v_now          bigint;
BEGIN
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

    -- Serialize dedup operations for this id (matches add_job and the finish
    -- paths: advisory lock taken before the id-counter INCR below).
    IF v_dedup_id IS NOT NULL AND v_dedup_id <> '' THEN
      PERFORM pg_advisory_xact_lock(
        hashtext('bullmq:dedup:' || v_queue || ':' || v_dedup_id));
    END IF;

    IF v_id IS NULL OR v_id = '' THEN
      v_id := next_job_id(v_queue);
    END IF;

    -- Root deduplication: if a live key already won, return its id and skip
    -- inserting this job (and, because it never exists, its descendants).
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

    -- An entry whose parent does not exist (a child of a deduplicated root, or
    -- a genuinely missing parent) is not inserted; report -5 as addJob does,
    -- without aborting the rest of the flow.
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
        -- New job: register a pending dependency on its parent.
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
        -- The job already existed: re-attach it to this new parent (mirrors
        -- handleDuplicatedJob). -7 means it already has a different parent.
        -- The parent is never released here: the rest of the tree is not in
        -- yet, so that check is deferred to the end of the flow.
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

    -- Accumulate lifecycle events for newly-inserted jobs; they are flushed in
    -- a single set-based INSERT after the loop. Accumulation order (per job:
    -- 'added' then the state event, in job order) is what the flush replays via
    -- WITH ORDINALITY, preserving the stream ordering the per-row publish gave.
    IF v_inserted THEN
      -- Every stored job announces itself (mirrors storeJob.lua's 'added').
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

  -- ── Flush accumulated lifecycle events in one statement ──────────────────
  IF array_length(v_ev_queue, 1) > 0 THEN
    -- Single set-based append. The id DEFAULT nextval('event_seq') is
    -- assigned in ordinality order (the ORDER BY pins row-production order), so
    -- the stream keeps each job's 'added' → state-event ordering.
    INSERT INTO event (queue, event, data, created_at_ms)
    SELECT q, ev, dat, (extract(epoch FROM clock_timestamp()) * 1000)::bigint
      FROM unnest(v_ev_queue, v_ev_event, v_ev_data)
             WITH ORDINALITY AS t(q, ev, dat, ord)
     ORDER BY ord;

    -- One 'bullmq_events' wakeup per distinct queue, then trim that queue's
    -- stream once (not per publish). A non-blocking advisory lock keeps at most
    -- one trimmer per queue; publishers that miss it skip (the next flush covers
    -- the same rows). Matches publish_event's approximate-MAXLEN trim.
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

    -- One 'bullmq_jobs' wakeup per distinct queue that gained a runnable job.
    FOR v_queue IN SELECT DISTINCT q FROM unnest(v_notify_jobs) AS q LOOP
      PERFORM pg_notify('bullmq_jobs', v_queue);
    END LOOP;
  END IF;

  -- ── Release parents left without pending dependencies ────────────────────
  -- Now that every node of the flow is in, a parent whose dependencies were
  -- all already-completed jobs (so nothing pending was ever registered) can
  -- safely be released. move_parent_to_wait is a no-op for any parent that is
  -- not in waiting-children, so this is safe for every parent of the flow.
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
