-- BullMQ PostgreSQL backend — two-phase stalled detection (schema v24).
--
-- The previous single-statement `move_stalled_jobs_to_wait` command reclaimed an
-- active job the instant its lock expired. Under a fast-forwarding clock (e.g.
-- repeatable-job tests that tick the fake clock by a month inside the processor)
-- a freshly-claimed job's short lock looks "expired" immediately, so the stalled
-- checker would yank the in-flight job back to wait and its completion would then
-- fail with "not in the active state".
--
-- Redis avoids this with a two-phase mark/sweep (moveStalledJobsToWait-9.lua):
--   * A `stalled-check` throttle key bounds how often the scan runs.
--   * Jobs are *marked* on one pass and only *reclaimed* on the next pass if they
--     are still active with an expired lock — so a job that completes (or renews
--     its lock) between two passes is never reclaimed.
--   * Scheduler ("repeatable") jobs are recovered but never permanently failed,
--     no matter how many times they stall.
--
-- This migration replaces the command's body with a PL/pgSQL function that mirrors
-- that behaviour. A `stalled_marked` flag plays the role of the Redis `stalled`
-- SET.

ALTER TABLE bullmq_job
  ADD COLUMN IF NOT EXISTS stalled_marked boolean NOT NULL DEFAULT false;

CREATE FUNCTION bullmq_move_stalled_jobs_to_wait(
  p_queue          text,
  p_max_stalled    integer,
  p_now            bigint,
  p_max_check_time bigint
) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_last       bigint;
  r            record;
  v_count      integer;
  v_repeatable boolean;
  v_reclaimed  boolean := false;
BEGIN
  -- Throttle: only run once per `max_check_time` window (mirrors the Redis
  -- `stalled-check` key with `PX maxCheckTime`).
  SELECT value::bigint INTO v_last
    FROM bullmq_meta WHERE queue = p_queue AND field = 'stalled-check';
  IF v_last IS NOT NULL AND p_now < v_last + p_max_check_time THEN
    RETURN;
  END IF;
  INSERT INTO bullmq_meta (queue, field, value)
    VALUES (p_queue, 'stalled-check', p_now::text)
    ON CONFLICT (queue, field) DO UPDATE SET value = EXCLUDED.value;

  -- Phase 1 (sweep): reclaim jobs that were marked on a PREVIOUS pass and are
  -- still active with an expired lock.
  FOR r IN
    SELECT id, scheduler_id, stalled_count
      FROM bullmq_job
     WHERE queue = p_queue
       AND state = 'active'
       AND stalled_marked
       AND locked_until_ms IS NOT NULL
       AND locked_until_ms < p_now
     FOR UPDATE SKIP LOCKED
  LOOP
    v_count := r.stalled_count + 1;

    -- Scheduler jobs are recovered but never permanently failed.
    v_repeatable := r.scheduler_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM bullmq_scheduler
       WHERE queue = p_queue AND scheduler_id = r.scheduler_id
    );

    UPDATE bullmq_job
       SET state = 'waiting',
           lock_token = NULL,
           locked_until_ms = NULL,
           stalled_marked = false,
           stalled_count = v_count,
           seq = nextval('bullmq_job_seq'),
           deferred_failure = CASE
             WHEN v_count > p_max_stalled AND NOT v_repeatable
               THEN 'job stalled more than allowable limit'
             ELSE deferred_failure
           END
     WHERE queue = p_queue AND id = r.id;

    PERFORM bullmq_publish_event(p_queue, 'stalled',
      jsonb_build_object('jobId', r.id));
    v_reclaimed := true;
    RETURN NEXT r.id;
  END LOOP;

  -- Clear all old marks (mirrors `DEL stalledKey`) …
  UPDATE bullmq_job SET stalled_marked = false
   WHERE queue = p_queue AND stalled_marked;

  -- … then mark every currently-active job for the NEXT pass (mirrors
  -- `SADD stalledKey <active>`). Freshly-claimed jobs are therefore never
  -- reclaimed on the pass that first observes them.
  UPDATE bullmq_job SET stalled_marked = true
   WHERE queue = p_queue AND state = 'active';

  -- Wake a worker for any jobs pushed back to wait.
  IF v_reclaimed THEN
    PERFORM pg_notify('bullmq_jobs', p_queue);
  END IF;
  RETURN;
END;
$$;
