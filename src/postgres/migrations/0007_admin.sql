-- BullMQ PostgreSQL backend — admin operations & getters (schema version 7).
--
-- pause/resume, drain, remove, bulk retry/promote, and the job-id range getter
-- used by getJobs. move_to_active is recreated to honor the paused flag.

-- ──────────────────────────────────────────────────────────────────────────
-- pause: set/clear the queue's paused flag (an O(1) meta flag — no bulk move).
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_pause(p_queue text, p_paused boolean) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF p_paused THEN
    INSERT INTO bullmq_meta (queue, field, value)
    VALUES (p_queue, 'paused', '1')
    ON CONFLICT (queue, field) DO UPDATE SET value = '1';
  ELSE
    -- Resume mirrors Redis `HDEL meta paused`: the field is removed entirely,
    -- so `isPaused` (hasQueueMetaField 'paused') reports false rather than
    -- finding a lingering '0'.
    DELETE FROM bullmq_meta WHERE queue = p_queue AND field = 'paused';
  END IF;

  PERFORM bullmq_publish_event(
    p_queue, CASE WHEN p_paused THEN 'paused' ELSE 'resumed' END, '{}'::jsonb
  );
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- drain: remove waiting (and optionally delayed) jobs; leaves active/finished.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_drain(p_queue text, p_delayed boolean) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  DELETE FROM bullmq_job WHERE queue = p_queue AND state = 'waiting';
  IF p_delayed THEN
    DELETE FROM bullmq_job WHERE queue = p_queue AND state = 'delayed';
  END IF;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- remove: delete a job (and optionally its children). Returns 1 if removed,
-- 0 if it is locked (held by a worker) or absent.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_remove(
  p_queue text, p_id text, p_remove_children boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_locked  boolean;
  v_deleted integer;
BEGIN
  SELECT lock_token IS NOT NULL INTO v_locked
    FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  IF v_locked THEN
    RETURN 0;
  END IF;

  IF p_remove_children THEN
    DELETE FROM bullmq_job WHERE queue = p_queue AND parent_id = p_id;
  END IF;

  DELETE FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- retry_jobs: move up to `count` finished jobs of a state back to waiting.
-- Returns the number moved (the caller loops until it returns 0).
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_retry_jobs(
  p_queue text, p_state text, p_count integer, p_timestamp bigint
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_moved integer;
BEGIN
  WITH batch AS (
    SELECT id FROM bullmq_job
     WHERE queue = p_queue
       AND state = p_state::bullmq_job_state
       AND (p_timestamp IS NULL OR finished_at_ms <= p_timestamp)
     ORDER BY finished_at_ms
     LIMIT p_count
  )
  UPDATE bullmq_job j
     SET state = 'waiting',
         seq = nextval('bullmq_job_seq'),
         finished_at_ms = NULL,
         processed_at_ms = NULL,
         return_value = NULL,
         failed_reason = NULL,
         stacktrace = NULL,
         attempts_made = 0,
         attempts_started = 0,
         lock_token = NULL,
         locked_until_ms = NULL
    FROM batch
   WHERE j.queue = p_queue AND j.id = batch.id;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  IF v_moved > 0 THEN
    PERFORM pg_notify('bullmq_jobs', p_queue);
  END IF;
  RETURN v_moved;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- promote_jobs: move up to `count` delayed jobs to waiting (process now).
-- Returns the number moved (the caller loops until it returns 0).
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_promote_jobs(p_queue text, p_count integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_moved integer;
BEGIN
  WITH batch AS (
    SELECT id FROM bullmq_job
     WHERE queue = p_queue AND state = 'delayed'
     ORDER BY process_at_ms
     LIMIT p_count
  )
  UPDATE bullmq_job j
     SET state = 'waiting', process_at_ms = NULL, seq = nextval('bullmq_job_seq')
    FROM batch
   WHERE j.queue = p_queue AND j.id = batch.id;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  IF v_moved > 0 THEN
    PERFORM pg_notify('bullmq_jobs', p_queue);
  END IF;
  RETURN v_moved;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- get_range: the job ids in a given state, sliced by [start, end] (inclusive,
-- zero-based). List-like states (wait/active/waiting-children) are returned in
-- ascending seq order (the getter layer reverses them for `asc`); zset-like
-- states honour the requested direction.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_get_range(
  p_queue text, p_type text, p_start integer, p_end integer, p_asc boolean
) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_where  text;
  v_order  text;
  v_dir    text := CASE WHEN p_asc THEN 'ASC' ELSE 'DESC' END;
  v_offset integer := GREATEST(COALESCE(p_start, 0), 0);
  v_limit  text;
BEGIN
  -- 'wait'/'active' are list-backed in Redis (LPUSH ⇒ newest at head), and the
  -- shared queue-getters layer reverses these `lrange` results when asc is
  -- requested. Returning newest-first (DESC) here makes that reversal yield the
  -- FIFO order callers expect (getWaiting/getActive), mirroring Redis LRANGE.
  IF p_type IN ('wait', 'waiting') THEN
    v_where := 'state = ''waiting'' AND priority = 0'; v_order := 'seq'; v_dir := 'DESC';
  ELSIF p_type = 'prioritized' THEN
    v_where := 'state = ''waiting'' AND priority > 0'; v_order := 'priority, seq';
  ELSIF p_type = 'active' THEN
    v_where := 'state = ''active'''; v_order := 'seq'; v_dir := 'DESC';
  ELSIF p_type = 'delayed' THEN
    v_where := 'state = ''delayed'''; v_order := 'process_at_ms';
  ELSIF p_type IN ('completed', 'failed') THEN
    v_where := format('state = %L', p_type); v_order := 'finished_at_ms';
  ELSIF p_type = 'waiting-children' THEN
    v_where := 'state = ''waiting-children'''; v_order := 'seq'; v_dir := 'ASC';
  ELSE
    RETURN; -- paused/repeat/unknown
  END IF;

  IF p_end IS NULL OR p_end < 0 THEN
    v_limit := 'ALL';
  ELSE
    IF (p_end - v_offset + 1) <= 0 THEN
      RETURN;
    END IF;
    v_limit := (p_end - v_offset + 1)::text;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT id FROM bullmq_job WHERE queue = %L AND %s ORDER BY %s %s OFFSET %s LIMIT %s',
    p_queue, v_where, v_order, v_dir, v_offset, v_limit
  );
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- Recreate move_to_active to skip claiming while the queue is paused.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bullmq_move_to_active(
  p_queue   text,
  p_token   text,
  p_lock_ms bigint,
  p_now     bigint
) RETURNS SETOF bullmq_job
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id  text;
  v_job bullmq_job;
BEGIN
  IF EXISTS (
    SELECT 1 FROM bullmq_meta
     WHERE queue = p_queue AND field = 'paused' AND value = '1'
  ) THEN
    RETURN;
  END IF;

  UPDATE bullmq_job
     SET state = 'waiting'
   WHERE queue = p_queue
     AND state = 'delayed'
     AND process_at_ms <= p_now;

  SELECT id INTO v_id
    FROM bullmq_job
   WHERE queue = p_queue AND state = 'waiting'
   ORDER BY priority, seq
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE bullmq_job
     SET state = 'active',
         lock_token = p_token,
         locked_until_ms = p_now + p_lock_ms,
         processed_at_ms = p_now,
         attempts_started = attempts_started + 1
   WHERE queue = p_queue AND id = v_id
  RETURNING * INTO v_job;

  PERFORM bullmq_publish_event(p_queue, 'active',
    jsonb_build_object('jobId', v_id, 'prev', 'waiting'));

  RETURN NEXT v_job;
END;
$$;
