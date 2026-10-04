-- BullMQ PostgreSQL backend — re-adding a child that already failed.
--
-- Replaces `handle_duplicated_job` (created in 0002_functions.sql). Re-adding an
-- existing job with a parent registered it as a pending dependency unless it
-- had completed. A failed job is not re-run by a duplicated add, so the parent
-- waited in `waiting-children` forever, even when the child's own failure had
-- been resolved by ignoreDependencyOnFailure, removeDependencyOnFailure,
-- continueParentOnFailure or failParentOnFailure. Such a dependency is now
-- recorded the way the child's failure would have resolved it
-- (`handle_child_failure`), mirroring the Redis `updateExistingJobsParent`
-- include.
--
-- Like the completed-child branch, it never registers a pending dependency for
-- the failed child and takes no parent advisory lock: taking that lock after the
-- parent row has been touched would invert the lock order of the finish paths.
--
-- Only the function body changes — no schema/DDL change — so the signature is
-- identical and older clients keep working against the updated schema.

CREATE OR REPLACE FUNCTION handle_duplicated_job(
  p_queue        text,
  p_id           text,
  p_parent_queue text,
  p_parent_id    text,
  p_parent_key   text,
  p_now          bigint
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
  v_reason    text;
  v_opts      jsonb;
  v_fpof      boolean;
  v_cpof      boolean;
  v_idof      boolean;
  v_rdof      boolean;
BEGIN
  -- No new parent to attach: still a duplicate add, so announce it.
  IF p_parent_id IS NULL OR p_parent_queue IS NULL THEN
    PERFORM publish_event(p_queue, 'duplicated',
      jsonb_build_object('jobId', p_id));
    RETURN 0;
  END IF;

  SELECT parent_queue, parent_id, state, return_value, failed_reason, opts
    INTO v_ex_pq, v_ex_pid, v_state, v_rv, v_reason, v_opts
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

  v_fpof := COALESCE((v_opts->>'failParentOnFailure')::boolean, false);
  v_cpof := COALESCE((v_opts->>'continueParentOnFailure')::boolean, false);
  v_idof := COALESCE((v_opts->>'ignoreDependencyOnFailure')::boolean, false);
  v_rdof := COALESCE((v_opts->>'removeDependencyOnFailure')::boolean, false);

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

    SELECT pending_deps INTO v_remaining
      FROM job WHERE queue = p_parent_queue AND id = p_parent_id;
    IF COALESCE(v_remaining, 0) = 0 THEN
      PERFORM move_parent_to_wait(p_parent_queue, p_parent_id, p_now);
    END IF;
  ELSIF v_state = 'failed' AND (v_fpof OR v_cpof OR v_idof OR v_rdof) THEN
    -- Already failed and not re-run by this add: record the dependency the way
    -- handle_child_failure resolves a live failure, without a pending increment.
    IF v_fpof OR v_cpof OR v_idof THEN
      INSERT INTO job_dependency (
        parent_queue, parent_id, child_queue, child_id, child_key, status, value
      ) VALUES (
        p_parent_queue, p_parent_id, p_queue, p_id, p_queue || ':' || p_id,
        CASE WHEN v_fpof THEN 'failed'::dep_status ELSE 'ignored'::dep_status END,
        to_jsonb(v_reason)
      )
      ON CONFLICT (parent_queue, parent_id, child_key) DO NOTHING;
    END IF;

    IF v_fpof THEN
      UPDATE job
         SET deferred_failure = 'child ' || p_queue || ':' || p_id || ' failed'
       WHERE queue = p_parent_queue AND id = p_parent_id;
      PERFORM move_parent_to_wait(p_parent_queue, p_parent_id, p_now);
    ELSIF v_cpof THEN
      PERFORM move_parent_to_wait(p_parent_queue, p_parent_id, p_now);
    ELSE
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
