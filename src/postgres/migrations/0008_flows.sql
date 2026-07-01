-- BullMQ PostgreSQL backend — flows (schema version 8).
--
-- `bullmq_add_flow` atomically inserts a whole tree of jobs (possibly spanning
-- multiple queues) from a single JSONB array of entries, ordered roots-first so
-- a parent always exists before its children register a dependency. `drain` is
-- recreated to be flow-aware: when draining a queue's children resolves a
-- parent's last pending dependency, the parent is removed (same queue) or moved
-- to wait (different queue), mirroring the Redis `removeParentDependencyKey`.

-- ──────────────────────────────────────────────────────────────────────────
-- add_flow: insert an ordered (roots-first) array of flow entries atomically.
-- Returns the resulting job ids in the same order as the input entries.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_add_flow(p_entries jsonb) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  e              jsonb;
  v_id           text;
  v_seq          bigint;
  v_state        bullmq_job_state;
  v_process_at   bigint;
  v_queue        text;
  v_delay        bigint;
  v_timestamp    bigint;
  v_lifo         boolean;
  v_parent_queue text;
  v_parent_id    text;
  v_awc          boolean;
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

    IF v_id IS NULL OR v_id = '' THEN
      INSERT INTO bullmq_meta (queue, field, value)
        VALUES (v_queue, 'id', '1')
        ON CONFLICT (queue, field)
        DO UPDATE SET value = (bullmq_meta.value::bigint + 1)::text
        RETURNING value INTO v_id;
    END IF;

    v_seq := nextval('bullmq_job_seq');
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

    INSERT INTO bullmq_job (
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

    -- Register this job as a pending dependency of its parent (if any).
    IF v_parent_id IS NOT NULL AND v_parent_queue IS NOT NULL THEN
      INSERT INTO bullmq_job_dependency (
        parent_queue, parent_id, child_queue, child_id, child_key, status
      ) VALUES (
        v_parent_queue, v_parent_id, v_queue, v_id,
        v_queue || ':' || v_id, 'pending'
      )
      ON CONFLICT (parent_queue, parent_id, child_key) DO NOTHING;

      UPDATE bullmq_job
         SET pending_deps = pending_deps + 1
       WHERE queue = v_parent_queue AND id = v_parent_id;
    END IF;

    -- Wake workers / emit lifecycle events for jobs that became processable.
    IF v_state = 'waiting' THEN
      PERFORM pg_notify('bullmq_jobs', v_queue);
      PERFORM bullmq_publish_event(v_queue, 'waiting',
        jsonb_build_object('jobId', v_id));
    ELSIF v_state = 'delayed' THEN
      PERFORM pg_notify('bullmq_jobs', v_queue);
      PERFORM bullmq_publish_event(v_queue, 'delayed',
        jsonb_build_object('jobId', v_id, 'delay', v_process_at));
    END IF;

    RETURN NEXT v_id;
  END LOOP;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- Recreate drain to be flow-aware.
--
-- Removes waiting (covers wait/prioritized/paused-as-waiting) and optionally
-- delayed jobs. For each removed child, its parent's pending dependency is
-- cleared; a parent left with no pending dependencies is either removed (when
-- it lives in the drained queue) or moved to wait (when it lives elsewhere).
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bullmq_drain(p_queue text, p_delayed boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_pq  text[];
  v_pid text[];
  i     integer;
BEGIN
  -- Snapshot the distinct parents of the children about to be drained.
  SELECT array_agg(parent_queue), array_agg(parent_id)
    INTO v_pq, v_pid
  FROM (
    SELECT DISTINCT parent_queue, parent_id
      FROM bullmq_job
     WHERE queue = p_queue
       AND parent_id IS NOT NULL
       AND (state = 'waiting' OR (p_delayed AND state = 'delayed'))
  ) s;

  -- Clear the dependency links for the children being drained.
  DELETE FROM bullmq_job_dependency d
   USING bullmq_job j
   WHERE j.queue = p_queue
     AND (j.state = 'waiting' OR (p_delayed AND j.state = 'delayed'))
     AND j.parent_id IS NOT NULL
     AND d.parent_queue = j.parent_queue
     AND d.parent_id = j.parent_id
     AND d.child_queue = j.queue
     AND d.child_id = j.id;

  -- Remove the drained jobs (waiting / optionally delayed).
  DELETE FROM bullmq_job
   WHERE queue = p_queue
     AND (state = 'waiting' OR (p_delayed AND state = 'delayed'));

  -- Reconcile parents whose pending children were just drained.
  IF v_pq IS NOT NULL THEN
    FOR i IN 1 .. array_length(v_pq, 1) LOOP
      UPDATE bullmq_job p
         SET pending_deps = (
           SELECT count(*) FROM bullmq_job_dependency d
            WHERE d.parent_queue = v_pq[i]
              AND d.parent_id = v_pid[i]
              AND d.status = 'pending'
         )
       WHERE p.queue = v_pq[i] AND p.id = v_pid[i];

      PERFORM 1 FROM bullmq_job p
       WHERE p.queue = v_pq[i] AND p.id = v_pid[i]
         AND p.state = 'waiting-children'
         AND p.pending_deps = 0;

      IF FOUND THEN
        IF v_pq[i] = p_queue THEN
          -- Parent in the drained queue: drop it along with its children.
          DELETE FROM bullmq_job WHERE queue = v_pq[i] AND id = v_pid[i];
        ELSE
          -- Parent elsewhere: move it to wait so it can be processed.
          UPDATE bullmq_job
             SET state = 'waiting', seq = nextval('bullmq_job_seq')
           WHERE queue = v_pq[i] AND id = v_pid[i];
          PERFORM pg_notify('bullmq_jobs', v_pq[i]);
          PERFORM bullmq_publish_event(v_pq[i], 'waiting',
            jsonb_build_object('jobId', v_pid[i], 'prev', 'waiting-children'));
        END IF;
      END IF;
    END LOOP;
  END IF;
END;
$$;
