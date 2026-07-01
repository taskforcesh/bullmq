-- BullMQ PostgreSQL backend — core operation functions (schema version 3).
--
-- Portable PL/pgSQL implementations of the atomic queue operations, mirroring
-- the Redis Lua scripts. Functions are created inside the backend's schema and
-- bake that schema into their `search_path` (FROM CURRENT, captured from the
-- migration's `SET LOCAL search_path`), so their unqualified table references
-- always resolve to the right namespace regardless of the caller's session
-- search_path. The TypeScript backend invokes them schema-qualified, e.g.
-- `SELECT * FROM "bullmq".bullmq_move_to_active(...)`.
--
-- This migration covers the foundational FIFO slice: add a job, claim the next
-- ready job (FOR UPDATE SKIP LOCKED), and finish it (complete/fail), plus lock
-- extension. Advanced behaviour (retries/backoff, rate limiting, flows
-- finalization, retention/removeOn, schedulers) is layered on in later
-- migrations.

-- ──────────────────────────────────────────────────────────────────────────
-- add_job: insert a single job, routing it to waiting or delayed.
-- Returns the (possibly generated) job id.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_add_job(
  p_queue        text,
  p_id           text,
  p_name         text,
  p_data         jsonb,
  p_opts         jsonb,
  p_priority     integer,
  p_delay        bigint,
  p_timestamp    bigint,
  p_max_attempts integer,
  p_parent_queue text,
  p_parent_id    text,
  p_parent_key   text,
  p_dedup_id     text,
  p_scheduler_id text,
  p_lifo         boolean
) RETURNS text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id    text := p_id;
  v_seq   bigint;
  v_state bullmq_job_state;
  v_process_at bigint;
BEGIN
  -- Generate a per-queue numeric id when none was supplied (mirrors the Redis
  -- `<prefix>:<queue>:id` INCR counter).
  IF v_id IS NULL OR v_id = '' THEN
    INSERT INTO bullmq_meta (queue, field, value)
      VALUES (p_queue, 'id', '1')
      ON CONFLICT (queue, field)
      DO UPDATE SET value = (bullmq_meta.value::bigint + 1)::text
      RETURNING value INTO v_id;
  END IF;

  v_seq := nextval('bullmq_job_seq');
  IF p_lifo THEN
    v_seq := -v_seq;
  END IF;

  IF p_delay > 0 THEN
    v_state := 'delayed';
    v_process_at := p_timestamp + p_delay;
  ELSE
    v_state := 'waiting';
    v_process_at := NULL;
  END IF;

  INSERT INTO bullmq_job (
    queue, id, seq, name, state,
    data, opts, priority, delay_ms, max_attempts,
    added_at_ms, process_at_ms,
    dedup_id, scheduler_id,
    parent_queue, parent_id, parent_key
  ) VALUES (
    p_queue, v_id, v_seq, p_name, v_state,
    COALESCE(p_data, '{}'::jsonb), COALESCE(p_opts, '{}'::jsonb),
    COALESCE(p_priority, 0), COALESCE(p_delay, 0), COALESCE(p_max_attempts, 1),
    p_timestamp, v_process_at,
    p_dedup_id, p_scheduler_id,
    p_parent_queue, p_parent_id, p_parent_key
  )
  ON CONFLICT (queue, id) DO NOTHING;

  -- Wake any worker blocked in waitForJob. A single fixed channel keeps the
  -- LISTEN side static and portable; the payload carries the queue so workers
  -- filter for their own queue.
  PERFORM pg_notify('bullmq_jobs', p_queue);

  RETURN v_id;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- move_to_active: atomically claim the next ready job for a worker.
-- Promotes any due delayed jobs first, then claims the highest-priority/oldest
-- waiting job with FOR UPDATE SKIP LOCKED so concurrent workers never collide.
-- Returns the claimed job row (0 or 1 rows).
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_move_to_active(
  p_queue   text,
  p_token   text,
  p_lock_ms bigint,
  p_now     bigint
) RETURNS SETOF bullmq_job
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  -- Promote due delayed jobs in a separate statement so the claim below sees
  -- them (CTEs would share one snapshot and miss the promotion).
  UPDATE bullmq_job
     SET state = 'waiting'
   WHERE queue = p_queue
     AND state = 'delayed'
     AND process_at_ms <= p_now;

  RETURN QUERY
    WITH claimed AS (
      SELECT j.id
        FROM bullmq_job j
       WHERE j.queue = p_queue
         AND j.state = 'waiting'
       ORDER BY j.priority, j.seq
       FOR UPDATE SKIP LOCKED
       LIMIT 1
    )
    UPDATE bullmq_job j
       SET state = 'active',
           lock_token = p_token,
           locked_until_ms = p_now + p_lock_ms,
           processed_at_ms = p_now,
           attempts_started = j.attempts_started + 1
      FROM claimed
     WHERE j.queue = p_queue
       AND j.id = claimed.id
    RETURNING j.*;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- next_delay: the timestamp of the next delayed job (for worker block timing),
-- or NULL when there are none.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_next_delay(p_queue text) RETURNS bigint
LANGUAGE sql
SET search_path FROM CURRENT
AS $$
  SELECT MIN(process_at_ms)
    FROM bullmq_job
   WHERE queue = p_queue AND state = 'delayed';
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- move_to_completed: finish an active job successfully.
-- Verifies the lock token, records the return value and finished timestamp.
-- Returns the finished_at timestamp, or raises if the job is not held.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_move_to_completed(
  p_queue        text,
  p_id           text,
  p_token        text,
  p_return_value jsonb,
  p_finished_on  bigint
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE bullmq_job
     SET state = 'completed',
         return_value = p_return_value,
         finished_at_ms = p_finished_on,
         lock_token = NULL,
         locked_until_ms = NULL,
         attempts_made = attempts_made + 1
   WHERE queue = p_queue
     AND id = p_id
     AND state = 'active'
     AND lock_token = p_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'bullmq: job % is not active or lock mismatch', p_id
      USING ERRCODE = 'BM001';
  END IF;

  RETURN p_finished_on;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- move_to_failed: mark an active job failed.
-- Foundational version: records the reason and finishes the job. Retry/backoff
-- (re-queueing to waiting/delayed when attempts remain) is added in a later
-- migration.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_move_to_failed(
  p_queue         text,
  p_id            text,
  p_token         text,
  p_failed_reason text,
  p_finished_on   bigint
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE bullmq_job
     SET state = 'failed',
         failed_reason = p_failed_reason,
         finished_at_ms = p_finished_on,
         lock_token = NULL,
         locked_until_ms = NULL,
         attempts_made = attempts_made + 1
   WHERE queue = p_queue
     AND id = p_id
     AND state = 'active'
     AND lock_token = p_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'bullmq: job % is not active or lock mismatch', p_id
      USING ERRCODE = 'BM001';
  END IF;

  RETURN p_finished_on;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- extend_lock: refresh an active job's lock if the token still holds it.
-- Returns 1 on success, 0 if the lock was lost.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_extend_lock(
  p_queue    text,
  p_id       text,
  p_token    text,
  p_lock_ms  bigint,
  p_now      bigint
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE bullmq_job
     SET locked_until_ms = p_now + p_lock_ms
   WHERE queue = p_queue
     AND id = p_id
     AND state = 'active'
     AND lock_token = p_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;
