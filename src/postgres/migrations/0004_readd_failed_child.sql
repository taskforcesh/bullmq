-- BullMQ PostgreSQL backend — re-adding a child that already failed.
--
-- Replaces `handle_duplicated_job` (created in 0002_functions.sql). Re-adding an
-- existing job with a parent registered it as a pending dependency unless it
-- had completed. A failed job is not re-run by a duplicated add, so the parent
-- waited in `waiting-children` forever, even when the child's own failure had
-- been resolved by ignoreDependencyOnFailure, removeDependencyOnFailure,
-- continueParentOnFailure or failParentOnFailure. The dependency is now settled
-- the way the child's failure was (`handle_child_failure`). Mirrors the Redis
-- `updateExistingJobsParent` include.
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
BEGIN
  -- No new parent to attach: still a duplicate add, so announce it.
  IF p_parent_id IS NULL OR p_parent_queue IS NULL THEN
    PERFORM publish_event(p_queue, 'duplicated',
      jsonb_build_object('jobId', p_id));
    RETURN 0;
  END IF;

  SELECT parent_queue, parent_id, state, return_value, failed_reason
    INTO v_ex_pq, v_ex_pid, v_state, v_rv, v_reason
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

    SELECT pending_deps INTO v_remaining
      FROM job WHERE queue = p_parent_queue AND id = p_parent_id;
    IF COALESCE(v_remaining, 0) = 0 THEN
      PERFORM move_parent_to_wait(p_parent_queue, p_parent_id, p_now);
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

  -- A failed job is not re-run by a duplicated add, so resolve the pending
  -- dependency registered above the same way its failure would have.
  IF v_state = 'failed' THEN
    PERFORM handle_child_failure(p_queue, p_id, v_reason, p_now);
  END IF;

  PERFORM publish_event(p_queue, 'duplicated',
    jsonb_build_object('jobId', p_id));

  RETURN 0;
END;
$$;
