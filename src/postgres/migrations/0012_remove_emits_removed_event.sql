-- Emit a 'removed' event for every job deleted by `remove` (Queue.remove /
-- Job.remove), with `prev` set to the job's state before removal, as the Redis
-- backend does in removeJob-2.lua / removeJobWithChildren. Function-body fix
-- only (CREATE OR REPLACE, identical signature).
CREATE OR REPLACE FUNCTION remove(
  p_queue text, p_id text, p_remove_children boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_found     boolean := false;
  v_scheduler text;
  v_pq        text;
  v_pid       text;
  v_locked    boolean;
  v_remaining integer;
  v_deleted   integer := 0;
  v_prev      job_state;
  v_now       bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  r           RECORD;
BEGIN
  SELECT true, scheduler_id, parent_queue, parent_id
    INTO v_found, v_scheduler, v_pq, v_pid
    FROM job WHERE queue = p_queue AND id = p_id;

  IF NOT COALESCE(v_found, false) THEN
    RETURN 0;
  END IF;

  IF v_scheduler IS NOT NULL THEN
    RAISE EXCEPTION 'job belongs to a scheduler'
      USING ERRCODE = 'BM001', DETAIL = '-8';
  END IF;

  -- Lock check. A job cannot be removed while it is locked; with removeChildren
  -- the check recurses through still-pending descendants (mirrors isLocked()).
  IF p_remove_children THEN
    WITH RECURSIVE subtree AS (
      SELECT p_queue AS q, p_id AS id
      UNION
      SELECT d.child_queue, d.child_id
        FROM subtree s
        JOIN job_dependency d
          ON d.parent_queue = s.q AND d.parent_id = s.id
         AND d.status = 'pending'
    )
    SELECT EXISTS (
      SELECT 1 FROM subtree s
       JOIN job j ON j.queue = s.q AND j.id = s.id
      WHERE j.lock_token IS NOT NULL AND j.locked_until_ms > v_now
    ) INTO v_locked;
  ELSE
    SELECT lock_token IS NOT NULL AND locked_until_ms > v_now INTO v_locked
      FROM job WHERE queue = p_queue AND id = p_id;
  END IF;

  IF v_locked THEN
    RETURN 0;
  END IF;

  -- Detach the removed root from its parent's pending dependency set; if that
  -- clears the parent's last pending dependency, promote it to wait. Only
  -- pending links matter (a processed/failed child was already accounted for).
  IF v_pq IS NOT NULL AND v_pid IS NOT NULL THEN
    DELETE FROM job_dependency
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = p_queue || ':' || p_id
       AND status = 'pending';
    IF FOUND THEN
      UPDATE job SET pending_deps = GREATEST(pending_deps - 1, 0)
       WHERE queue = v_pq AND id = v_pid
      RETURNING pending_deps INTO v_remaining;
      IF v_remaining = 0 THEN
        PERFORM move_parent_to_wait(v_pq, v_pid, v_now);
      END IF;
    END IF;
  END IF;

  IF p_remove_children THEN
    -- Delete the whole subtree (root + descendants via parent_queue/parent_id).
    FOR r IN
      WITH RECURSIVE subtree AS (
        SELECT p_queue AS q, p_id AS id, dedup_id AS dd
          FROM job WHERE queue = p_queue AND id = p_id
        UNION
        SELECT j.queue, j.id, j.dedup_id
          FROM subtree s
          JOIN job j ON j.parent_queue = s.q AND j.parent_id = s.id
      )
      SELECT q, id, dd FROM subtree
    LOOP
      PERFORM dedup_on_removal(r.q, r.id, r.dd);
      DELETE FROM job WHERE queue = r.q AND id = r.id
      RETURNING state INTO v_prev;
      IF FOUND THEN
        v_deleted := v_deleted + 1;
        PERFORM publish_event(r.q, 'removed',
          jsonb_build_object('jobId', r.id, 'prev', v_prev::text));
      END IF;
    END LOOP;
  ELSE
    PERFORM dedup_on_removal(
      p_queue, p_id,
      (SELECT dedup_id FROM job WHERE queue = p_queue AND id = p_id));
    DELETE FROM job WHERE queue = p_queue AND id = p_id
    RETURNING state INTO v_prev;
    IF FOUND THEN
      v_deleted := 1;
      PERFORM publish_event(p_queue, 'removed',
        jsonb_build_object('jobId', p_id, 'prev', v_prev::text));
    END IF;
  END IF;

  RETURN v_deleted;
END;
$$;
