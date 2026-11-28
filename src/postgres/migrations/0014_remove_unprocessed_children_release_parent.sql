-- BullMQ PostgreSQL backend: removeUnprocessedChildren releases the parent
-- (schema version 14).
--
-- remove_unprocessed_children decremented the parent's pending_deps for every
-- child it removed, but it left the parent's job_dependency rows in place
-- (they only cascade from the parent side) and never released the parent. The
-- parent stayed in waiting-children and getDependencies/getDependenciesCount
-- kept reporting the removed children as unprocessed.
--
-- It now mirrors removeParentDependencyKey in removeJobWithChildren.lua:
--   * the removed child's pending job_dependency row is deleted together with
--     the decrement,
--   * once the parent has no pending dependencies left, it is released with
--     move_parent_to_wait, as remove_child_dependency already does. A parent
--     that isn't in waiting-children (e.g. the active parent calling this from
--     its own processor) is left alone, as on Redis.
--
-- It also checks each child's state again when deleting it. The children are
-- read once, up front, so a worker could pick one up in between and the child
-- was deleted while it ran (its completion then failed with a missing key).
-- On Redis the whole removal is one script, so a job a worker holds is always
-- skipped.
-- Same signature as before.
CREATE OR REPLACE FUNCTION remove_unprocessed_children(
  p_queue text, p_id text
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r           RECORD;
  v_now       bigint := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_removed   boolean := false;
  v_remaining integer;
BEGIN
  -- Serialize with concurrent child resolutions of this parent (see
  -- move_to_completed). Taken before the first pending_deps decrement: a
  -- sibling completing meanwhile takes this lock and then updates the parent
  -- row, so taking it later could deadlock against that sibling.
  PERFORM pg_advisory_xact_lock(
    hashtext('bullmq:parent:' || p_queue || ':' || p_id));

  FOR r IN
    WITH RECURSIVE subtree AS (
      SELECT j.queue AS q, j.id AS id, true AS direct
        FROM job_dependency d
        JOIN job j ON j.queue = d.child_queue AND j.id = d.child_id
       WHERE d.parent_queue = p_queue AND d.parent_id = p_id
         AND d.status = 'pending'
         AND j.state NOT IN ('active', 'failed', 'completed')
         AND j.lock_token IS NULL
      UNION
      SELECT j.queue, j.id, false
        FROM subtree s
        JOIN job_dependency d
          ON d.parent_queue = s.q AND d.parent_id = s.id AND d.status = 'pending'
        JOIN job j ON j.queue = d.child_queue AND j.id = d.child_id
       WHERE j.state NOT IN ('active', 'failed', 'completed')
         AND j.lock_token IS NULL
    )
    SELECT q, id, direct FROM subtree
  LOOP
    -- Skip the job if a worker took it after the walk above read it.
    DELETE FROM job
     WHERE queue = r.q AND id = r.id
       AND state NOT IN ('active', 'failed', 'completed')
       AND lock_token IS NULL;
    CONTINUE WHEN NOT FOUND;

    -- Take the child out of its parent's dependencies and decrement the
    -- parent's pending counter.
    WITH dep AS (
      DELETE FROM job_dependency
       WHERE child_queue = r.q AND child_id = r.id AND status = 'pending'
      RETURNING parent_queue, parent_id
    )
    UPDATE job p SET pending_deps = GREATEST(p.pending_deps - 1, 0)
      FROM dep
     WHERE p.queue = dep.parent_queue AND p.id = dep.parent_id;
    PERFORM publish_event(r.q, 'removed',
      jsonb_build_object('jobId', r.id, 'prev', 'waiting'));
    v_removed := v_removed OR r.direct;
  END LOOP;

  IF v_removed THEN
    SELECT pending_deps INTO v_remaining
      FROM job WHERE queue = p_queue AND id = p_id;
    IF v_remaining = 0 THEN
      PERFORM move_parent_to_wait(p_queue, p_id, v_now);
    END IF;
  END IF;
END;
$$;
