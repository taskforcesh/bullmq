-- BullMQ PostgreSQL backend — flow failure propagation (schema version 29).
--
-- When a child job fails permanently, its parent must react according to the
-- child's parent-link options (mirrors moveChildFromDependenciesIfNeeded):
--   * failParentOnFailure (fpof)      → record the child as a failed dependency,
--                                        defer a failure onto the parent and (if
--                                        it is waiting on children) release it so
--                                        a worker picks it up and fails it.
--   * continueParentOnFailure (cpof)  → record the child as an ignored
--                                        dependency and release the parent.
--   * ignoreDependencyOnFailure (idof)→ record the child as ignored and release
--                                        the parent once no pending deps remain.
--   * removeDependencyOnFailure (rdof)→ drop the dependency entirely and release
--                                        the parent once no pending deps remain.
-- The PG backend stores raw JobsOptions, so the long option names are read
-- straight from the child's `opts`.

-- Release a parent from waiting-children to wait (mirrors moveParentToWait —
-- priority is preserved by the row's `priority` column; FIFO order via a fresh
-- seq). Emits the 'waiting' (prev waiting-children) event and wakes a worker.
CREATE FUNCTION bullmq_move_parent_to_wait(
  p_parent_queue text, p_parent_id text, p_now bigint
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  UPDATE bullmq_job
     SET state = 'waiting', seq = nextval('bullmq_job_seq')
   WHERE queue = p_parent_queue AND id = p_parent_id
     AND state = 'waiting-children';
  IF FOUND THEN
    PERFORM pg_notify('bullmq_jobs', p_parent_queue);
    PERFORM bullmq_publish_event(p_parent_queue, 'waiting',
      jsonb_build_object('jobId', p_parent_id, 'prev', 'waiting-children'));
  END IF;
END;
$$;

-- Propagate a child's permanent failure to its parent.
CREATE FUNCTION bullmq_handle_child_failure(
  p_queue text, p_id text, p_reason text, p_now bigint
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_pq        text;
  v_pid       text;
  v_opts      jsonb;
  v_child_key text;
  v_remaining integer;
BEGIN
  SELECT parent_queue, parent_id, opts INTO v_pq, v_pid, v_opts
    FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  IF v_pid IS NULL OR v_pq IS NULL THEN
    RETURN;
  END IF;
  v_child_key := p_queue || ':' || p_id;

  IF COALESCE((v_opts->>'failParentOnFailure')::boolean, false) THEN
    UPDATE bullmq_job_dependency
       SET status = 'failed', value = to_jsonb(p_reason)
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = v_child_key AND status = 'pending';
    IF FOUND THEN
      UPDATE bullmq_job SET pending_deps = GREATEST(pending_deps - 1, 0)
       WHERE queue = v_pq AND id = v_pid;
      -- Defer the failure onto the parent; when a worker activates it the
      -- deferred failure fails it immediately (worker checks job.deferredFailure).
      UPDATE bullmq_job
         SET deferred_failure = 'child ' || v_child_key || ' failed'
       WHERE queue = v_pq AND id = v_pid;
      PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, p_now);
    END IF;

  ELSIF COALESCE((v_opts->>'continueParentOnFailure')::boolean, false) THEN
    UPDATE bullmq_job_dependency
       SET status = 'ignored', value = to_jsonb(p_reason)
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = v_child_key AND status = 'pending';
    IF FOUND THEN
      UPDATE bullmq_job SET pending_deps = GREATEST(pending_deps - 1, 0)
       WHERE queue = v_pq AND id = v_pid;
      PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, p_now);
    END IF;

  ELSIF COALESCE((v_opts->>'ignoreDependencyOnFailure')::boolean, false) THEN
    UPDATE bullmq_job_dependency
       SET status = 'ignored', value = to_jsonb(p_reason)
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = v_child_key AND status = 'pending';
    IF FOUND THEN
      UPDATE bullmq_job SET pending_deps = GREATEST(pending_deps - 1, 0)
       WHERE queue = v_pq AND id = v_pid
      RETURNING pending_deps INTO v_remaining;
      IF v_remaining = 0 THEN
        PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, p_now);
      END IF;
    END IF;

  ELSIF COALESCE((v_opts->>'removeDependencyOnFailure')::boolean, false) THEN
    DELETE FROM bullmq_job_dependency
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = v_child_key AND status = 'pending';
    IF FOUND THEN
      UPDATE bullmq_job SET pending_deps = GREATEST(pending_deps - 1, 0)
       WHERE queue = v_pq AND id = v_pid
      RETURNING pending_deps INTO v_remaining;
      IF v_remaining = 0 THEN
        PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, p_now);
      END IF;
    END IF;
  END IF;
END;
$$;

-- ── removeChildDependency: break a child's link to its parent (mirrors
--    removeChildDependency-1.lua). Returns 0 when the relationship existed and
--    was removed, 1 when there was no relationship; raises -1 (missing job) /
--    -5 (missing parent).
CREATE FUNCTION bullmq_remove_child_dependency(
  p_queue text, p_id text, p_parent_key text, p_now bigint
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_pq        text;
  v_pid       text;
  v_deleted   integer;
  v_remaining integer;
BEGIN
  SELECT parent_queue, parent_id INTO v_pq, v_pid
    FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bullmq: missing job %', p_id
      USING ERRCODE = 'BM001', DETAIL = '-1';
  END IF;
  IF v_pq IS NULL OR v_pid IS NULL THEN
    RETURN 1; -- no relationship
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bullmq_job WHERE queue = v_pq AND id = v_pid
  ) THEN
    RAISE EXCEPTION 'bullmq: missing parent %', p_parent_key
      USING ERRCODE = 'BM001', DETAIL = '-5';
  END IF;

  DELETE FROM bullmq_job_dependency
   WHERE parent_queue = v_pq AND parent_id = v_pid
     AND child_key = p_queue || ':' || p_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN 1;
  END IF;

  -- Detach the child and release the parent if it has no more pending deps.
  UPDATE bullmq_job
     SET parent_queue = NULL, parent_id = NULL, parent_key = NULL
   WHERE queue = p_queue AND id = p_id;
  UPDATE bullmq_job SET pending_deps = GREATEST(pending_deps - 1, 0)
   WHERE queue = v_pq AND id = v_pid
  RETURNING pending_deps INTO v_remaining;
  IF v_remaining = 0 THEN
    PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, p_now);
  END IF;
  RETURN 0;
END;
$$;

-- ── removeUnprocessedChildren: recursively remove a parent's still-pending
--    children (skipping active/locked ones), mirroring removeUnprocessedChildren-2.
--    Emits 'removed' for each child taken out; cascades clean up dependency rows.
CREATE FUNCTION bullmq_remove_unprocessed_children(
  p_queue text, p_id text
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    WITH RECURSIVE subtree AS (
      SELECT j.queue AS q, j.id AS id
        FROM bullmq_job_dependency d
        JOIN bullmq_job j ON j.queue = d.child_queue AND j.id = d.child_id
       WHERE d.parent_queue = p_queue AND d.parent_id = p_id
         AND d.status = 'pending'
         AND j.state <> 'active' AND j.lock_token IS NULL
      UNION
      SELECT j.queue, j.id
        FROM subtree s
        JOIN bullmq_job_dependency d
          ON d.parent_queue = s.q AND d.parent_id = s.id AND d.status = 'pending'
        JOIN bullmq_job j ON j.queue = d.child_queue AND j.id = d.child_id
       WHERE j.state <> 'active' AND j.lock_token IS NULL
    )
    SELECT q, id FROM subtree
  LOOP
    -- Decrement the (live) parent's pending counter for direct children.
    UPDATE bullmq_job p SET pending_deps = GREATEST(pending_deps - 1, 0)
      FROM bullmq_job_dependency d
     WHERE d.child_queue = r.q AND d.child_id = r.id AND d.status = 'pending'
       AND p.queue = d.parent_queue AND p.id = d.parent_id;
    DELETE FROM bullmq_job WHERE queue = r.q AND id = r.id;
    PERFORM bullmq_publish_event(r.q, 'removed',
      jsonb_build_object('jobId', r.id, 'prev', 'waiting'));
  END LOOP;
END;
$$;
