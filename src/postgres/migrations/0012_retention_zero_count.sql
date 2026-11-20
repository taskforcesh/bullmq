-- BullMQ PostgreSQL backend — keep-count 0 retention fix.
--
-- Replaces `apply_retention` (created in 0002_functions.sql). A keep-count of
-- `0` (`removeOnComplete: 0`, `{ count: 0 }`, ...) used to fall through to the
-- count-based trim with `LIMIT 0`, deleting *every* finished job of that state
-- in the queue — including jobs added with `removeOnComplete: false`. It now
-- removes only the job that just finished, exactly like `p_remove_all`
-- (mirrors Redis `moveToFinished`, where `maxCount == 0` only removes the
-- current job's keys).
--
-- Only the function body changes — no schema/DDL change — so the signature is
-- identical and older clients keep working against the updated schema.

CREATE OR REPLACE FUNCTION apply_retention(
  p_queue       text,
  p_id          text,
  p_state       job_state,
  p_now         bigint,
  p_remove_all  boolean,
  p_keep_age    bigint,
  p_keep_count  integer
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_pq        text;
  v_pid       text;
  v_remaining integer;
BEGIN
  IF p_remove_all OR p_keep_count = 0 THEN
    -- If this job is a still-pending child (e.g. a default-failed child with
    -- removeOnFail), detach it and release its parent when it was the last
    -- pending dependency (mirrors removeParentDependencyKey on removal). A
    -- processed/failed dependency is left untouched so the parent keeps it.
    SELECT parent_queue, parent_id INTO v_pq, v_pid
      FROM job WHERE queue = p_queue AND id = p_id;
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
          PERFORM move_parent_to_wait(v_pq, v_pid, p_now);
        END IF;
      END IF;
    END IF;

    DELETE FROM job WHERE queue = p_queue AND id = p_id;
    RETURN;
  END IF;

  IF p_keep_age IS NOT NULL AND p_keep_age >= 0 THEN
    DELETE FROM job
     WHERE queue = p_queue
       AND state = p_state
       AND finished_at_ms <= p_now - p_keep_age * 1000;
  END IF;

  -- A negative keep-count is the "keep everything" sentinel (mirrors Redis,
  -- where -1 disables count-based trimming); skip it — a negative SQL LIMIT is
  -- a hard error.
  IF p_keep_count IS NOT NULL AND p_keep_count >= 0 THEN
    DELETE FROM job
     WHERE queue = p_queue
       AND state = p_state
       AND id NOT IN (
         SELECT id FROM job
          WHERE queue = p_queue AND state = p_state
          ORDER BY finished_at_ms DESC, seq DESC
          LIMIT p_keep_count
       );
  END IF;
END;
$$;
