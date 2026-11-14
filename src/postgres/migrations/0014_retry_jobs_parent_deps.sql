-- BullMQ PostgreSQL backend — retry_jobs flow parent bookkeeping.
--
-- `queue.retryJobs()` moves finished jobs back to waiting through `retry_jobs`
-- (created in 0002_functions.sql). That function rewrote the job row and zeroed
-- `attempts_made` / `attempts_started`, but it left the child's `job_dependency`
-- row in its finished status and did not count the child toward the parent
-- again. A later sibling completion then saw `pending_deps = 0` and released
-- the parent while the retried child was still waiting.
--
-- Redis `moveJobsToWait` (via `moveChildBackToParentDependencies`) puts the
-- child back on the parent's dependencies and does not touch `atm` / `ats`.
-- `reprocess_job` (used by `job.retry()`) already restores the dependency.
-- This replaces only the function body: same signature, so older clients keep
-- working against the updated schema.
--
-- A parent that has already left `waiting-children` is not moved back there.
-- That matches Redis: retrying a child re-pends the dependency and nothing else.
--
-- Advisory locks follow move_to_failed / handle_child_failure: the failing
-- job's own `bullmq:parent:<queue>:<id>` key, then its parent's. Every key is
-- taken before any row lock. Deeper jobs are locked first (a child is always
-- deeper than its parent); same-depth keys use hashtext order so two retries
-- take overlapping keys in the same order. A NULL count moves at most 1000
-- jobs, matching the Redis backend. Callers loop until this returns 0.

CREATE OR REPLACE FUNCTION retry_jobs(
  p_queue text, p_state text, p_count integer, p_timestamp bigint
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_ids    text[];
  v_key    record;
  v_rows   jsonb;
  v_moved  integer := 0;
  -- Redis retryFinishedJobs defaults an omitted count to 1000 and the queue
  -- methods loop. LIMIT NULL would lock every distinct parent until commit.
  v_limit  integer := COALESCE(p_count, 1000);
BEGIN
  SELECT array_agg(id)
    INTO v_ids
    FROM (
      SELECT id
        FROM job
       WHERE queue = p_queue
         AND state = p_state::job_state
         AND (p_timestamp IS NULL OR finished_at_ms <= p_timestamp)
       ORDER BY finished_at_ms
       LIMIT v_limit
    ) picked;

  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  -- Selected jobs and their direct parents. Own keys are included so a retried
  -- parent (itself a child in another queue) is locked before its row is
  -- updated. Depth is the number of parent hops along existing rows, so a
  -- missing parent row still counts as one hop and sorts after its child.
  FOR v_key IN
    WITH RECURSIVE keys AS (
      SELECT p_queue AS queue, picked_id AS id
        FROM unnest(v_ids) AS picked_id
      UNION
      SELECT parent_queue, parent_id
        FROM job
       WHERE queue = p_queue
         AND id = ANY(v_ids)
         AND parent_queue IS NOT NULL
         AND parent_id IS NOT NULL
    ),
    walk AS (
      SELECT k.queue, k.id, k.queue AS cur_queue, k.id AS cur_id, 0 AS depth
        FROM keys k
      UNION ALL
      SELECT w.queue, w.id, j.parent_queue, j.parent_id, w.depth + 1
        FROM walk w
        JOIN job j ON j.queue = w.cur_queue AND j.id = w.cur_id
       WHERE j.parent_queue IS NOT NULL
         AND j.parent_id IS NOT NULL
         AND w.depth < 1000
    ),
    depths AS (
      SELECT queue, id, MAX(depth) AS depth
        FROM walk
       GROUP BY queue, id
    )
    SELECT queue, id
      FROM depths
     ORDER BY depth DESC,
              hashtext('bullmq:parent:' || queue || ':' || id),
              queue,
              id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtext('bullmq:parent:' || v_key.queue || ':' || v_key.id));
  END LOOP;

  -- Move the jobs first, then re-pend parents in a second statement. A
  -- retried job can itself be a parent of another retried job; updating `job`
  -- twice in one statement leaves those rows unspecified.
  -- attempts_made and attempts_started are left as they are. Redis
  -- moveJobsToWait does not touch `atm` or `ats`.
  WITH updated AS (
    UPDATE job j
       SET state = 'waiting',
           seq = nextval('job_seq'),
           finished_at_ms = NULL,
           processed_at_ms = NULL,
           return_value = NULL,
           failed_reason = NULL,
           stacktrace = NULL,
           lock_token = NULL,
           locked_until_ms = NULL
     WHERE j.queue = p_queue
       AND j.id = ANY(v_ids)
       AND j.state = p_state::job_state
    RETURNING j.id, j.parent_queue, j.parent_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'pq', parent_queue, 'pid', parent_id
         )), '[]'::jsonb),
         COUNT(*)::integer
    INTO v_rows, v_moved
    FROM updated;

  IF v_moved = 0 THEN
    RETURN 0;
  END IF;

  -- Completed children leave `processed` (Redis `:processed`). Failed children
  -- leave `failed` (Redis `:unsuccessful`, failParentOnFailure) or `ignored`
  -- (Redis `:failed`, ignoreDependencyOnFailure / continueParentOnFailure).
  -- removeDependencyOnFailure deletes the row, so this matches nothing and the
  -- parent count stays unchanged.
  WITH src AS (
    SELECT elem->>'id' AS id,
           elem->>'pq' AS parent_queue,
           elem->>'pid' AS parent_id
      FROM jsonb_array_elements(v_rows) AS elems(elem)
     WHERE elem->>'pq' IS NOT NULL
       AND elem->>'pid' IS NOT NULL
  ),
  repended AS (
    UPDATE job_dependency d
       SET status = 'pending', value = NULL
      FROM src u
     WHERE d.parent_queue = u.parent_queue
       AND d.parent_id = u.parent_id
       AND d.child_key = p_queue || ':' || u.id
       AND d.status = ANY (
         CASE
           WHEN p_state = 'failed'
             THEN ARRAY['failed'::dep_status, 'ignored'::dep_status]
           ELSE ARRAY['processed'::dep_status]
         END
       )
       AND EXISTS (
         SELECT 1 FROM job p
          WHERE p.queue = u.parent_queue AND p.id = u.parent_id
       )
    RETURNING d.parent_queue, d.parent_id
  )
  UPDATE job p
     SET pending_deps = p.pending_deps + c.n
    FROM (
      SELECT parent_queue, parent_id, COUNT(*)::integer AS n
        FROM repended
       GROUP BY parent_queue, parent_id
    ) c
   WHERE p.queue = c.parent_queue AND p.id = c.parent_id;

  PERFORM pg_notify('bullmq_jobs', p_queue);
  RETURN v_moved;
END;
$$;

-- remove_child_dependency deleted the dependency row and updated the child
-- before pg_advisory_xact_lock on the parent. retry_jobs takes that parent
-- lock (after the child's own bullmq:parent key) before it updates the child
-- row, so the two orders deadlock: removal holds the child row and waits for
-- the parent lock, retry holds the parent lock and waits for the child row.
--
-- move_to_failed takes the child's own key, then the child row, then the
-- parent key inside handle_child_failure. Locking only the parent key before
-- the child row would deadlock with that path. Take the child's own key, then
-- the parent key, and only then change dependency or job rows — the same
-- order retry_jobs uses.

CREATE OR REPLACE FUNCTION remove_child_dependency(
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
    FROM job WHERE queue = p_queue AND id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bullmq: missing job %', p_id
      USING ERRCODE = 'BM001', DETAIL = '-1';
  END IF;
  IF v_pq IS NULL OR v_pid IS NULL THEN
    RETURN 1; -- no relationship
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM job WHERE queue = v_pq AND id = v_pid
  ) THEN
    RAISE EXCEPTION 'bullmq: missing parent %', p_parent_key
      USING ERRCODE = 'BM001', DETAIL = '-5';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('bullmq:parent:' || p_queue || ':' || p_id));
  PERFORM pg_advisory_xact_lock(
    hashtext('bullmq:parent:' || v_pq || ':' || v_pid));

  DELETE FROM job_dependency
   WHERE parent_queue = v_pq AND parent_id = v_pid
     AND child_key = p_queue || ':' || p_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN 1;
  END IF;

  -- Detach the child and release the parent if it has no more pending deps.
  UPDATE job
     SET parent_queue = NULL, parent_id = NULL, parent_key = NULL
   WHERE queue = p_queue AND id = p_id;
  UPDATE job SET pending_deps = GREATEST(pending_deps - 1, 0)
   WHERE queue = v_pq AND id = v_pid
  RETURNING pending_deps INTO v_remaining;
  IF v_remaining = 0 THEN
    PERFORM move_parent_to_wait(v_pq, v_pid, p_now);
  END IF;
  RETURN 0;
END;
$$;
