-- BullMQ PostgreSQL backend — step jobs / waiting-children (schema version 19).
--
--   * move_to_waiting_children: a parent with pending children → waiting-children
--     (returns 1 = should wait); no pending → 0 = proceed.
--   * move_to_completed also releases the parent: a completing child marks its
--     dependency processed and, when the parent has no pending deps left and is
--     waiting-children, promotes it back to waiting.

CREATE FUNCTION bullmq_move_to_waiting_children(
  p_queue text, p_id text, p_token text
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state   bullmq_job_state;
  v_lock    text;
  v_pending integer;
BEGIN
  SELECT state, lock_token, pending_deps INTO v_state, v_lock, v_pending
    FROM bullmq_job WHERE queue = p_queue AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bullmq: missing job %', p_id USING ERRCODE = 'BM001', DETAIL = '-1';
  END IF;
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'bullmq: job % not active', p_id USING ERRCODE = 'BM001', DETAIL = '-3';
  END IF;
  IF p_token <> '0' AND v_lock IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'bullmq: job % lock mismatch', p_id USING ERRCODE = 'BM001', DETAIL = '-6';
  END IF;

  IF v_pending > 0 THEN
    UPDATE bullmq_job
       SET state = 'waiting-children', lock_token = NULL, locked_until_ms = NULL
     WHERE queue = p_queue AND id = p_id;
    RETURN 1; -- should wait
  END IF;

  RETURN 0; -- no pending children: proceed
END;
$$;

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
  v_state    bullmq_job_state;
  v_lock     text;
  v_pq       text;
  v_pid      text;
  v_dedup_id text;
  v_remaining integer;
BEGIN
  SELECT state, lock_token, parent_queue, parent_id, dedup_id
    INTO v_state, v_lock, v_pq, v_pid, v_dedup_id
    FROM bullmq_job WHERE queue = p_queue AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bullmq: missing job %', p_id USING ERRCODE = 'BM001', DETAIL = '-1';
  END IF;
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'bullmq: job % not active', p_id USING ERRCODE = 'BM001', DETAIL = '-3';
  END IF;
  IF p_token <> '0' AND v_lock IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'bullmq: job % lock mismatch', p_id USING ERRCODE = 'BM001', DETAIL = '-6';
  END IF;

  -- A parent cannot complete while it still has unresolved children: pending
  -- children → -4, failed children → -9 (mirrors moveToFinished-14.lua, which
  -- only enforces this on the "completed" path).
  IF EXISTS (
    SELECT 1 FROM bullmq_job_dependency
     WHERE parent_queue = p_queue AND parent_id = p_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'bullmq: job % has pending dependencies', p_id
      USING ERRCODE = 'BM001', DETAIL = '-4';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bullmq_job_dependency
     WHERE parent_queue = p_queue AND parent_id = p_id AND status = 'failed'
  ) THEN
    RAISE EXCEPTION 'bullmq: job % has failed dependencies', p_id
      USING ERRCODE = 'BM001', DETAIL = '-9';
  END IF;

  UPDATE bullmq_job
     SET state = 'completed',
         return_value = p_return_value,
         finished_at_ms = p_finished_on,
         lock_token = NULL,
         locked_until_ms = NULL,
         attempts_made = attempts_made + 1
   WHERE queue = p_queue AND id = p_id;

  PERFORM bullmq_publish_event(p_queue, 'completed',
    jsonb_build_object('jobId', p_id, 'returnvalue',
      COALESCE(p_return_value, 'null'::jsonb)::text, 'prev', 'active'));

  -- Release the parent: mark this child's dependency processed and, if the
  -- parent has no pending deps left and is waiting on children, requeue it.
  IF v_pid IS NOT NULL AND v_pq IS NOT NULL THEN
    UPDATE bullmq_job_dependency
       SET status = 'processed', value = p_return_value
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = p_queue || ':' || p_id;

    UPDATE bullmq_job
       SET pending_deps = GREATEST(pending_deps - 1, 0)
     WHERE queue = v_pq AND id = v_pid
    RETURNING pending_deps INTO v_remaining;

    IF v_remaining = 0 THEN
      UPDATE bullmq_job
         SET state = 'waiting', seq = nextval('bullmq_job_seq')
       WHERE queue = v_pq AND id = v_pid AND state = 'waiting-children';
      IF FOUND THEN
        PERFORM pg_notify('bullmq_jobs', v_pq);
        PERFORM bullmq_publish_event(v_pq, 'waiting',
          jsonb_build_object('jobId', v_pid, 'prev', 'waiting-children'));
      END IF;
    END IF;
  END IF;

  PERFORM bullmq_apply_retention(
    p_queue, p_id, 'completed', p_finished_on, p_remove_all, p_keep_age, p_keep_count
  );

  -- Serialize dedup key mutations with concurrent adds for the same id (taken
  -- before requeue's id-counter INCR, matching add_job's advisory→meta order).
  IF v_dedup_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('bullmq:dedup:' || p_queue || ':' || v_dedup_id));
  END IF;
  -- Clear a no-ttl deduplication key now that its winner has finished.
  PERFORM bullmq_dedup_finalize(p_queue, v_dedup_id, p_id, p_finished_on);
  -- keepLastIfActive: turn any stashed proto-next into the new winner job.
  PERFORM bullmq_requeue_dedup_next(p_queue, v_dedup_id, p_finished_on);

  -- run, announce the queue is drained. Redis checks the physical wait + active
  -- + prioritized lists; when paused, jobs live in the paused list, so the wait
  -- list is empty and 'drained' still fires. Here that is: no active jobs and
  -- (the queue is paused OR there are no waiting/prioritized jobs).
  IF NOT EXISTS (
       SELECT 1 FROM bullmq_job WHERE queue = p_queue AND state = 'active'
     )
     AND (
       EXISTS (
         SELECT 1 FROM bullmq_meta
          WHERE queue = p_queue AND field = 'paused' AND value = '1'
       )
       OR NOT EXISTS (
         SELECT 1 FROM bullmq_job WHERE queue = p_queue AND state = 'waiting'
       )
     ) THEN
    PERFORM bullmq_publish_event(p_queue, 'drained', '{}'::jsonb);
  END IF;

  RETURN p_finished_on;
END;
$$;
